sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "sap/m/MessageBox"
], function (Controller, JSONModel, MessageToast, MessageBox) {
    "use strict";

    return Controller.extend("sap.stocktrading.app.controller.AdminDashboard", {

        onInit: function () {
            /* ── Admin notifications model ── */
            var oAdminVM = new JSONModel({
                notifications: { unreadCount: 0, items: [] }
            });
            this.getView().setModel(oAdminVM, "adminVM");

            this._loadDashboardData();
            var oRouter = this.getOwnerComponent().getRouter();
            var oRoute = oRouter.getRoute("admin");
            if (oRoute) { oRoute.attachPatternMatched(this._onRouteMatched, this); }

            // Global router listener to stop polling when navigating away from admin dashboard
            oRouter.attachRouteMatched(function (oEvent) {
                var sRouteName = oEvent.getParameter("name");
                if (sRouteName !== "admin") {
                    this._stopPolling();
                }
            }, this);

            this._intervalId = null;
        },

        _onRouteMatched: function () {
            this._loadDashboardData();
            this._startPolling();
        },

        _startPolling: function () {
            this._stopPolling();
            this._intervalId = setInterval(function () {
                this._loadDashboardData();
            }.bind(this), 3000); // 3 seconds live interval for Bloomberg-level responsiveness
        },

        _stopPolling: function () {
            if (this._intervalId) {
                clearInterval(this._intervalId);
                this._intervalId = null;
            }
        },

        onExit: function () {
            this._stopPolling();
            if (this._oChartPopover) {
                this._oChartPopover.destroy();
                this._oChartPopover = null;
            }
        },

        /* ═══ LOAD DATA ═══════════════════════════════════════════════════ */

        _loadDashboardData: async function () {
            try {
                var oModel = this.getOwnerComponent().getModel();
                if (!oModel) { return; }

                if (!this._oProductsBinding) {
                    this._oProductsBinding = oModel.bindList("/Products");
                }
                if (!this._oTxBinding) {
                    this._oTxBinding = oModel.bindList("/Transactions");
                }

                // Force cache invalidation to get real-time results from SQLite/HANA
                try {
                    this._oProductsBinding.refresh();
                    this._oTxBinding.refresh();
                } catch (err) {
                    // Ignore if binding is new or empty
                }

                var aProducts = await this._oProductsBinding.requestContexts(0, 1000);
                this.byId("statTotalStocks").setText(String(aProducts.length));

                var aTx = await this._oTxBinding.requestContexts(0, 5000);
                var iBuyers = 0, iSellers = 0;
                aTx.forEach(function (c) {
                    var t = c.getObject().transactionType;
                    if (t === "BUY") { iBuyers++; }
                    if (t === "SELL") { iSellers++; }
                });

                this.byId("statTotalBuyers").setText(String(iBuyers));
                this.byId("statTotalSellers").setText(String(iSellers));

                var aDailyData = this._buildDailyData(aTx);
                
                // Determine active year dynamically from the latest transaction date or current system time
                var sYear = new Date().getFullYear();
                var aDates = [];
                aTx.forEach(function (c) {
                    var t = c.getObject();
                    if (t && t.createdAt) {
                        aDates.push(String(t.createdAt).substring(0, 10));
                    }
                });
                if (aDates.length > 0) {
                    aDates.sort();
                    sYear = new Date(aDates[aDates.length - 1]).getFullYear();
                }

                this.getView().setModel(new JSONModel({ 
                    dailyData: aDailyData,
                    currentYear: String(sYear)
                }), "dashboard");

                var oViz = this.byId("dailyTradeChart");
                if (oViz) {
                    oViz.setVizProperties({
                        title: {
                            text: "Daily Buys vs Sells",
                            style: { color: "#ffffff", fontSize: "14px", fontWeight: "bold", fontFamily: "Inter" }
                        },
                        legend: {
                            visible: true,
                            label: { style: { color: "#94a3b8", fontFamily: "Inter" } }
                        },
                        categoryAxis: {
                            title: { visible: true, text: "Date", style: { color: "#94a3b8" } },
                            label: { style: { color: "#94a3b8" } },
                            gridLine: { visible: false },
                            axisLine: { visible: true, color: "#334155" }
                        },
                        valueAxis: {
                            title: { visible: true, text: "Transactions", style: { color: "#94a3b8" } },
                            label: { style: { color: "#94a3b8" } },
                            gridLine: { visible: true, color: "rgba(255,255,255,0.05)", size: 1 },
                            axisLine: { visible: false }
                        },
                        plotArea: {
                            background: { visible: false },
                            dataLabel: { visible: false },
                            colorPalette: ["#10b981", "#ef4444"],
                            line: { marker: { visible: true, size: 6 }, width: 3 }
                        },
                        background: { visible: false },
                        tooltip: { visible: true },
                        interaction: {
                            selectability: { mode: "single" },
                            hoverBehavior: "tooltip"
                        }
                    });

                    // Ensure dynamic Fiori Popover is connected to show detailed values on hover/click
                    if (!this._oChartPopover) {
                        var self = this;
                        sap.ui.require(["sap/viz/ui5/controls/Popover"], function (Popover) {
                            if (!self._oChartPopover) {
                                self._oChartPopover = new Popover();
                                self._oChartPopover.connect(oViz.getVizUid());
                            }
                        }, function (err) {
                            try {
                                self._oChartPopover = new sap.viz.ui5.controls.Popover();
                                self._oChartPopover.connect(oViz.getVizUid());
                            } catch (e) {
                                console.error("Could not load chart popover", e);
                            }
                        });
                    }
                }

                // Refresh Recently Created Stocks Table
                var oTable = this.byId("recentStocksTable");
                if (oTable) {
                    var oTableBinding = oTable.getBinding("items");
                    if (oTableBinding) {
                        oTableBinding.refresh();
                    }
                }

            } catch (e) {
                console.error("Dashboard load error:", e);
            }
            /* ── Refresh admin notifications alongside dashboard ── */
            this._refreshAdminNotifications();
        },

        /* ═══ BUILD DAILY CHART DATA ═══════════════════════════════════════
           Groups transactions by calendar date.
           Fills gaps (inactive days) with buys:0, sells:0.
           Always shows the last 30 calendar days to keep the x-axis crisp and clean.
        ═══════════════════════════════════════════════════════════════════ */
        _buildDailyData: function (aTx) {
            var oByDate = {};
            aTx.forEach(function (c) {
                var t = c.getObject();
                if (!t || !t.createdAt) { return; }
                var sDate = String(t.createdAt).substring(0, 10);
                if (!oByDate[sDate]) { oByDate[sDate] = { buys: 0, sells: 0 }; }
                if (t.transactionType === "BUY") { oByDate[sDate].buys++; }
                if (t.transactionType === "SELL") { oByDate[sDate].sells++; }
            });

            var oToday = new Date();
            oToday.setHours(0, 0, 0, 0);

            var oEnd = new Date(oToday);
            var aDates = Object.keys(oByDate).sort();
            if (aDates.length > 0) {
                var oLatestTxDate = new Date(aDates[aDates.length - 1]);
                if (oLatestTxDate > oEnd) {
                    oEnd = oLatestTxDate;
                }
            }

            // Always display exactly the last 30 calendar days to keep the x-axis crisp and clean
            var oStart = new Date(oEnd.getTime() - 29 * 24 * 60 * 60 * 1000);

            var aResult = [];
            for (var d = new Date(oStart); d <= oEnd; d.setDate(d.getDate() + 1)) {
                var sKey = d.toISOString().substring(0, 10);
                aResult.push({
                    date: (d.getMonth() + 1) + "/" + d.getDate(),
                    buys: (oByDate[sKey] || {}).buys || 0,
                    sells: (oByDate[sKey] || {}).sells || 0
                });
            }
            return aResult;
        },

        /* ═══ FORMATTERS ═══════════════════════════════════════════════════ */

        formatQtyState: function (v) {
            return v > 100 ? "Success" : v > 20 ? "Warning" : "Error";
        },
        formatChangePercent: function (price, prevPrice) {
            price = Number(price) || 0;
            prevPrice = Number(prevPrice) || price;
            if (prevPrice === 0) return "+0.00%";
            var pct = ((price - prevPrice) / prevPrice) * 100;
            return (pct >= 0 ? "+" : "") + pct.toFixed(2) + "%";
        },
        formatChangeState: function (price, prevPrice) {
            price = Number(price) || 0;
            prevPrice = Number(prevPrice) || price;
            return price >= prevPrice ? "Success" : "Error";
        },
        formatTrendState: function (v) {
            return v === "BULL" ? "Success" : v === "BEAR" ? "Error" : "Warning";
        },
        formatTrendIcon: function (v) {
            return v === "BULL" ? "sap-icon://trend-up" : v === "BEAR" ? "sap-icon://trend-down" : "sap-icon://minus";
        },
        formatStatusState: function (v) {
            return v === "ACTIVE" ? "Success" : v === "LOW" ? "Warning" : "Error";
        },

        /* ═══ NAV TABS ══════════════════════════════════════════════════════ */

        onTabDashboard: function () { this._setActiveTab("tabManage"); this._loadDashboardData(); },
        onTabStocks: function () { this._setActiveTab("tabManage"); this.getOwnerComponent().getRouter().navTo("manageStocks"); },
        onTabAnalytics: function () { this._setActiveTab("tabAnalytics"); this.getOwnerComponent().getRouter().navTo("analytics"); },
        onTabTrends: function () { this._setActiveTab("tabTrends"); this.getOwnerComponent().getRouter().navTo("priceTrends"); },
        onTabSettings: function () { this._setActiveTab("tabTrends"); MessageToast.show("Settings coming soon"); },

        _setActiveTab: function (sId) {
            ["tabManage", "tabAnalytics", "tabTrends"].forEach(function (id) {
                var o = this.byId(id);
                if (o) { o[id === sId ? "addStyleClass" : "removeStyleClass"]("adminNavTabActive"); }
            }.bind(this));
        },

        /* ═══ QUICK ACTIONS ════════════════════════════════════════════════ */

        onQuickCreateStock:  function () { this.getOwnerComponent().getRouter().navTo("createStock"); },
        onQuickManageStocks: function () { this.getOwnerComponent().getRouter().navTo("manageStocks"); },
        onQuickViewAnalytics: function () { this.getOwnerComponent().getRouter().navTo("analytics"); },
        onQuickPriceTrends: function () { this.getOwnerComponent().getRouter().navTo("priceTrends"); },


        /* ═══ TABLE ROW ════════════════════════════════════════════════════ */

        onStockRowPress: function (oEvent) {
            var oCtx = oEvent.getSource().getBindingContext();
            if (!oCtx) { return; }
            var d = oCtx.getObject();
            MessageBox.information(
                "Product  : " + d.productName + "\nPrice    : " + d.price + " " + d.currency +
                "\nQuantity : " + d.stockQuantity + "\nTrend    : " + d.trend + "\nStatus   : " + d.status,
                { title: d.productName }
            );
        },

        onRefresh: function () { this._loadDashboardData(); MessageToast.show("Dashboard refreshed"); },


        /* ═══ LOGOUT ═══════════════════════════════════════════════════════ */

        onLogout: function () {
            MessageBox.confirm("Are you sure you want to logout?", {
                title: "Confirm Logout",
                actions: [MessageBox.Action.OK, MessageBox.Action.CANCEL],
                onClose: function (sAction) {
                    if (sAction === MessageBox.Action.OK) { this.getOwnerComponent().getRouter().navTo("home"); }
                }.bind(this)
            });
        },

        /* ═══ ADMIN NOTIFICATIONS ═══════════════════════════════════════ */

        _refreshAdminNotifications: async function () {
            var oAdminVM = this.getView().getModel("adminVM");
            if (!oAdminVM) { return; }
            try {
                var oModel = this.getOwnerComponent().getModel();
                if (!oModel) { return; }

                if (!this._oAdminNotifBinding) {
                    this._oAdminNotifBinding = oModel.bindList("/Notifications", null,
                        [new sap.ui.model.Sorter("createdAt", true)], // newest first
                        [new sap.ui.model.Filter("isRead", sap.ui.model.FilterOperator.EQ, false)]
                    );
                }

                try {
                    this._oAdminNotifBinding.refresh();
                } catch (e) {}

                var aCtx = await this._oAdminNotifBinding.requestContexts(0, 50);

                var aItems = aCtx.map(function (c) {
                    var n = c.getObject();
                    var when = n.createdAt ? new Date(n.createdAt) : new Date();
                    var tsMs = when.getTime();
                    var diff = Date.now() - tsMs;
                    var mins = Math.floor(diff / 60000);
                    var sAgo = "just now";
                    if (mins >= 1440) { sAgo = Math.floor(mins / 1440) + "d ago"; }
                    else if (mins >= 60) { sAgo = Math.floor(mins / 60) + "h ago"; }
                    else if (mins >= 1) { sAgo = mins + "m ago"; }

                    // Custom mapping for admin
                    var sTitle = n.title;
                    var sType = n.type || "info";
                    if (sType === "buy") { sTitle = "Buy Order"; }
                    else if (sType === "sell") { sTitle = "Sell Order"; }
                    else if (sType === "alert") { sTitle = "Low Stock Warning"; }
                    else if (sType === "spike") { sTitle = "Volatility Alert"; }

                    return {
                        ID: n.ID,
                        type: sType,
                        title: sTitle,
                        message: n.message || "",
                        time: sAgo,
                        ts: tsMs
                    };
                });

                oAdminVM.setProperty("/notifications/items", aItems);
                oAdminVM.setProperty("/notifications/unreadCount", aItems.length);

            } catch (e) {
                console.error("Admin notification refresh error:", e);
            }
        },

        onAdminNotificationsPress: function (oEvent) {
            var oAdminVM = this.getView().getModel("adminVM");
            var aItems   = (oAdminVM && oAdminVM.getProperty("/notifications/items")) || [];
 
            var oNotifModel = new JSONModel({ items: aItems });
 
            var oList = new sap.m.List({
                items: {
                    path    : "notif>/items",
                    template: new sap.m.CustomListItem({
                        type: "Active",
                        press: async (oEvt) => {
                            var oItemCtx = oEvt.getSource().getBindingContext("notif");
                            var sId = oItemCtx.getProperty("ID");
                            try {
                                var oModel = this.getOwnerComponent().getModel();
                                var oContext = oModel.bindContext(`/Notifications(${sId})`);
                                await oContext.getBoundContext().setProperty("isRead", true);
                                
                                MessageToast.show("Alert dismissed");
                                this._refreshAdminNotifications();
                                if (this._oAdminNotifPopover) {
                                    this._oAdminNotifPopover.close();
                                }
                            } catch (err) {
                                console.error("Mark admin notification read error:", err);
                            }
                        },
                        content: [
                            new sap.m.HBox({
                                alignItems: "Center",
                                items: [
                                    new sap.m.VBox({
                                        items: [
                                            new sap.m.HBox({
                                                justifyContent: "SpaceBetween",
                                                items: [
                                                    new sap.m.Text({ text: "{notif>title}" }).addStyleClass("cdNotifTitle"),
                                                    new sap.m.Text({ text: "{notif>time}" }).addStyleClass("cdNotifTime")
                                                ]
                                            }),
                                            new sap.m.Text({ text: "{notif>message}" }).addStyleClass("cdNotifMessage")
                                        ]
                                    }).addStyleClass("cdNotifContent")
                                ]
                            }).addStyleClass("cdNotifItem")
                        ]
                    })
                },
                noDataText    : "🎉 All clear — no new alerts!",
                showSeparators: "Inner"
            });
 
            oList.setModel(oNotifModel, "notif");
 
            if (this._oAdminNotifPopover) {
                this._oAdminNotifPopover.destroy();
                this._oAdminNotifPopover = null;
            }
 
            var self = this;
            this._oAdminNotifPopover = new sap.m.Popover({
                title        : "🔔 Admin Notifications",
                contentWidth : "380px",
                contentHeight: "460px",
                placement    : "Bottom",
                showHeader   : true,
                content      : [ oList ],
                endButton    : new sap.m.Button({
                    text : "Clear All",
                    type : "Transparent",
                    press: async () => {
                        try {
                            var oModel = this.getOwnerComponent().getModel();
                            var oAct = oModel.bindContext("/clearAllNotifications(...)");
                            oAct.setParameter("customerName", "admin");
                            await oAct.execute();

                            if (oAdminVM) {
                                oAdminVM.setProperty("/notifications/items", []);
                                oAdminVM.setProperty("/notifications/unreadCount", 0);
                            }
                            oNotifModel.setProperty("/items", []);
                            
                            MessageToast.show("All notifications cleared");
                            if (self._oAdminNotifPopover) {
                                self._oAdminNotifPopover.close();
                            }
                        } catch (err) {
                            console.error("Clear all admin notifications error:", err);
                        }
                    }
                }),
                afterClose: function () {
                    if (self._oAdminNotifPopover) {
                        self._oAdminNotifPopover.destroy();
                        self._oAdminNotifPopover = null;
                    }
                }
            });
 
            this._oAdminNotifPopover.addStyleClass("cdNotifPopover");
            this.getView().addDependent(this._oAdminNotifPopover);
            var oSource = oEvent ? oEvent.getSource() : this.byId("adminBellBtn");
            this._oAdminNotifPopover.openBy(oSource);
        },

        /* ═══ STOCK GRAPH DIALOG ════════════════════════════════════════════
           Price Fluctuation Logic:
           - BUY  day  → price rises   by volatilityPct × random(0.5–1.0)
           - SELL day  → price falls   by volatilityPct × random(0.5–1.0)
           - TICK day  → small drift   weighted by buyPressure vs sellPressure
           - Inactive day (no trade)  → natural decay −0.1% to −0.3%
             (represented as TICK with equal pressure in HistoricalPrices)
        ═══════════════════════════════════════════════════════════════════ */

        onViewStockGraph: function (oEvent) {
            oEvent.cancelBubble();
            var oCtx = oEvent.getSource().getBindingContext();
            if (!oCtx) { return; }
            var oProduct = oCtx.getObject();
            if (!oProduct || !oProduct.ID) { MessageToast.show("No product data"); return; }
            this._loadAndShowStockGraph(oProduct);
        },

        _loadAndShowStockGraph: function (oProduct) {
            var self = this;
            sap.ui.require([
                "sap/ui/model/Filter",
                "sap/ui/model/FilterOperator",
                "sap/ui/model/Sorter",
                "sap/viz/ui5/controls/VizFrame",
                "sap/viz/ui5/data/FlattenedDataset",
                "sap/viz/ui5/data/DimensionDefinition",
                "sap/viz/ui5/data/MeasureDefinition",
                "sap/viz/ui5/controls/common/feeds/FeedItem",
                "sap/m/Dialog",
                "sap/m/Button",
                "sap/m/VBox",
                "sap/m/HBox",
                "sap/m/Label",
                "sap/m/Title",
                "sap/m/Text",
                "sap/m/ObjectStatus",
                "sap/m/MessageToast"
            ], function (Filter, FilterOperator, Sorter,
                VizFrame, FlattenedDataset, DimDef, MeasDef, FeedItem,
                Dialog, MButton, VBox, HBox, MLabel, MTitle, MText, ObjectStatus, MToast) {

                var oModel = self.getOwnerComponent().getModel();

                // OData v4: use Filter objects, NOT $filter string
                var oFilter = new Filter("product_ID", FilterOperator.EQ, oProduct.ID);
                var oSorter = new Sorter("createdAt", false); // ascending

                var oBinding = oModel.bindList(
                    "/HistoricalPrices",
                    null,
                    [oSorter],   // aSorters
                    [oFilter]    // aFilters — no mParameters needed, $top handled by requestContexts
                );

                oBinding.requestContexts().then(function (aCtx) {

                    if (!aCtx.length) {
                        MToast.show("No price history for " + oProduct.productName + ". Try buying/selling first.");
                        return;
                    }

                    var aData = aCtx.map(function (c) {
                        var h = c.getObject();
                        var dt = h.createdAt ? new Date(h.createdAt) : new Date();
                        return {
                            date: dt.toLocaleDateString(),
                            price: Number(h.price || 0),
                            changePct: Number(h.changePct || 0),
                            volume: Number(h.volume || 0),
                            reason: h.reason || "TICK"
                        };
                    });

                    var aPrices = aData.map(function (r) { return r.price; });
                    var fMax = Math.max.apply(null, aPrices);
                    var fMin = Math.min.apply(null, aPrices);
                    var fFirst = aData[0].price;
                    var fLast = aData[aData.length - 1].price;
                    var fChangePct = ((fLast - fFirst) / fFirst * 100).toFixed(2);

                    self._renderStockDialog(
                        oProduct, aData, fMax, fMin, fChangePct,
                        VizFrame, FlattenedDataset, DimDef, MeasDef, FeedItem,
                        Dialog, MButton, VBox, HBox, MLabel, MTitle, MText, ObjectStatus
                    );

                }).catch(function (e) {
                    console.error("[StockGraph] bindList error:", e);
                    MToast.show("Failed to load stock history: " + (e.message || e));
                });

            });
        },

        _renderStockDialog: function (oProduct, aData, fMax, fMin, fChangePct,
            VizFrame, FlattenedDataset, DimDef, MeasDef, FeedItem,
            Dialog, MButton, VBox, HBox, MLabel, MTitle, MText, ObjectStatus) {

            var bUp = Number(fChangePct) >= 0;
            var sColor = bUp ? "#059669" : "#dc2626";
            var sArrow = bUp ? "\u25b2" : "\u25bc";
            var sState = bUp ? "Success" : "Error";
            var oGM = new JSONModel({ rows: aData });

            var oViz = new VizFrame({ vizType: "line", width: "100%", height: "250px", uiConfig: { applicationSet: "fiori" } });
            oViz.setModel(oGM, "gm");
            oViz.setDataset(new FlattenedDataset({
                data: "{gm>/rows}",
                dimensions: [new DimDef({ name: "Date", value: "{gm>date}" })],
                measures: [new MeasDef({ name: "Price", value: "{gm>price}" })]
            }));
            oViz.addFeed(new FeedItem({ uid: "valueAxis", type: "Measure", values: ["Price"] }));
            oViz.addFeed(new FeedItem({ uid: "categoryAxis", type: "Dimension", values: ["Date"] }));
            oViz.setVizProperties({
                title: { text: "" },
                legend: { visible: false },
                plotArea: { dataLabel: { visible: false }, colorPalette: [sColor], line: { marker: { visible: true, size: 5 } } },
                categoryAxis: { title: { visible: true, text: "Date" } },
                valueAxis: { title: { visible: true, text: "Price (" + oProduct.currency + ")" } }
            });

            var oStats = new HBox({
                justifyContent: "SpaceBetween",
                items: [
                    new VBox({ items: [new MLabel({ text: "Current Price" }), new MTitle({ text: oProduct.currency + " " + oProduct.price, level: "H4" })] }),
                    new VBox({ items: [new MLabel({ text: "14-Day Change" }), new ObjectStatus({ text: sArrow + " " + Math.abs(fChangePct) + "%", state: sState })] }),
                    new VBox({ items: [new MLabel({ text: "14-Day High" }), new MText({ text: oProduct.currency + " " + fMax })] }),
                    new VBox({ items: [new MLabel({ text: "14-Day Low" }), new MText({ text: oProduct.currency + " " + fMin })] }),
                    new VBox({ items: [new MLabel({ text: "Trend" }), new ObjectStatus({ text: oProduct.trend, state: sState })] })
                ]
            });
            oStats.addStyleClass("sapUiSmallMarginBottom sapUiSmallMarginTop");

            var oContentBox = new VBox({
                items: [oStats, oViz]
            });
            oContentBox.addStyleClass("sapUiSmallMarginBeginEnd");

            var oDialog = new Dialog({
                title: "📈  " + oProduct.productName + " — Stock Price Graph",
                contentWidth: "680px",
                content: [oContentBox],
                endButton: new MButton({ text: "Close", type: "Transparent", press: function () { oDialog.close(); } }),
                afterClose: function () { oDialog.destroy(); }
            });
            oDialog.open();
        },

        /* ═══ TRANSACTION ANALYTICS POPUP DIALOGS ═══════════════════════════ */
        onOpenBuysDialog: function () {
            this._openAnalyticsDialog("BUY");
        },

        onOpenSellsDialog: function () {
            this._openAnalyticsDialog("SELL");
        },

        _openAnalyticsDialog: async function (sMode) {
            var self = this;
            var oView = this.getView();

            // Fetch transaction contexts
            var aTx = await this._oTxBinding.requestContexts(0, 5000);

            // Initialize Dialog Model
            var oDialogModel = new JSONModel({
                mode: sMode,
                range: "1M",
                chartData: this._getFilteredChartData(sMode, "1M", aTx)
            });

            // Segmented Button
            var oSegmentedButton = new sap.m.SegmentedButton({
                width: "330px",
                selectedKey: "{dialogModel>/range}",
                selectionChange: function (oEvent) {
                    var sNewRange = oEvent.getParameter("item").getKey();
                    var aFiltered = self._getFilteredChartData(sMode, sNewRange, aTx);
                    oDialogModel.setProperty("/chartData", aFiltered);
                }
            });
            oSegmentedButton.addStyleClass("cdSegmentedBtn");
            oSegmentedButton.addItem(new sap.m.SegmentedButtonItem({ key: "1D", text: "1D" }));
            oSegmentedButton.addItem(new sap.m.SegmentedButtonItem({ key: "1W", text: "1W" }));
            oSegmentedButton.addItem(new sap.m.SegmentedButtonItem({ key: "1M", text: "1M" }));
            oSegmentedButton.addItem(new sap.m.SegmentedButtonItem({ key: "3M", text: "3M" }));
            oSegmentedButton.addItem(new sap.m.SegmentedButtonItem({ key: "1Y", text: "1Y" }));

            // Programmatic VizFrame
            var oVizFrame = new sap.viz.ui5.controls.VizFrame({
                vizType: "line",
                width: "100%",
                height: "340px",
                uiConfig: { applicationSet: "fiori" }
            });

            var oDataset = new sap.viz.ui5.data.FlattenedDataset({
                data: "{dialogModel>/chartData}",
                dimensions: [
                    new sap.viz.ui5.data.DimensionDefinition({
                        name: "Time",
                        value: "{dialogModel>label}"
                    })
                ],
                measures: [
                    new sap.viz.ui5.data.MeasureDefinition({
                        name: "Transactions",
                        value: "{dialogModel>value}"
                    })
                ]
            });
            oVizFrame.setDataset(oDataset);

            oVizFrame.addFeed(new sap.viz.ui5.controls.common.feeds.FeedItem({
                uid: "valueAxis",
                type: "Measure",
                values: ["Transactions"]
            }));
            oVizFrame.addFeed(new sap.viz.ui5.controls.common.feeds.FeedItem({
                uid: "categoryAxis",
                type: "Dimension",
                values: ["Time"]
            }));

            oVizFrame.setVizProperties({
                title: { visible: false },
                legend: { visible: false },
                categoryAxis: {
                    title: { visible: true, text: "Timeline", style: { color: "#94a3b8" } },
                    label: { style: { color: "#94a3b8" } },
                    gridLine: { visible: false },
                    axisLine: { visible: true, color: "#334155" }
                },
                valueAxis: {
                    title: { visible: true, text: "Volume", style: { color: "#94a3b8" } },
                    label: { style: { color: "#94a3b8" } },
                    gridLine: { visible: true, color: "rgba(255,255,255,0.05)", size: 1 },
                    axisLine: { visible: false }
                },
                plotArea: {
                    background: { visible: false },
                    dataLabel: { visible: false },
                    colorPalette: [sMode === "BUY" ? "#10b981" : "#d97706"],
                    line: { marker: { visible: true, size: 6 }, width: 3 }
                },
                background: { visible: false },
                tooltip: { visible: true },
                interaction: {
                    selectability: { mode: "single" },
                    hoverBehavior: "tooltip"
                }
            });

            // Connect dynamic Popover
            var oPopover = new sap.viz.ui5.controls.Popover();
            oPopover.connect(oVizFrame.getVizUid());

            var oContentVBox = new sap.m.VBox({
                items: [
                    new sap.m.HBox({
                        justifyContent: "Center",
                        class: "sapUiSmallMarginBottom",
                        items: [ oSegmentedButton ]
                    }),
                    oVizFrame
                ]
            });
            oContentVBox.addStyleClass("sapUiSmallMarginBeginEnd sapUiSmallMarginTop");

            var oDialog = new sap.m.Dialog({
                title: sMode === "BUY" ? "🛒  Total Buys Analytics" : "📈  Total Sells Analytics",
                contentWidth: "680px",
                contentHeight: "450px",
                content: [ oContentVBox ],
                endButton: new sap.m.Button({
                    text: "Close",
                    type: "Transparent",
                    press: function () {
                        oDialog.close();
                    }
                }),
                afterClose: function () {
                    oPopover.destroy();
                    oDialog.destroy();
                }
            });

            oDialog.addStyleClass("adminAnalyticsDialog");
            oDialog.setModel(oDialogModel, "dialogModel");
            oView.addDependent(oDialog);
            oDialog.open();
        },

        _getFilteredChartData: function (sMode, sRange, aTx) {
            var oNow = new Date();
            var oByGroup = {};
            var aResult = [];

            // Extract objects
            var aItems = aTx.map(function (c) {
                var o = c.getObject();
                return {
                    type: o.transactionType,
                    date: o.createdAt ? new Date(o.createdAt) : null
                };
            }).filter(function (t) {
                return t.type === sMode && t.date;
            });

            if (sRange === "1D") {
                // Hourly grouping for the last 24 hours
                var oStart = new Date(oNow.getTime() - 24 * 60 * 60 * 1000);
                aItems.forEach(function (t) {
                    if (t.date >= oStart && t.date <= oNow) {
                        var iHour = t.date.getHours();
                        var sHour = (iHour < 10 ? "0" : "") + iHour + ":00";
                        oByGroup[sHour] = (oByGroup[sHour] || 0) + 1;
                    }
                });

                // Generate 24 hours
                for (var i = 23; i >= 0; i--) {
                    var d = new Date(oNow.getTime() - i * 60 * 60 * 1000);
                    var iHr = d.getHours();
                    var sLabel = (iHr < 10 ? "0" : "") + iHr + ":00";
                    aResult.push({
                        label: sLabel,
                        value: oByGroup[sLabel] || 0
                    });
                }
            } else if (sRange === "1W" || sRange === "1M" || sRange === "3M") {
                // Daily grouping
                var iDays = sRange === "1W" ? 7 : (sRange === "1M" ? 30 : 90);
                var oStart = new Date(oNow.getTime() - iDays * 24 * 60 * 60 * 1000);
                oStart.setHours(0, 0, 0, 0);

                aItems.forEach(function (t) {
                    if (t.date >= oStart && t.date <= oNow) {
                        var sDate = t.date.toISOString().substring(0, 10);
                        oByGroup[sDate] = (oByGroup[sDate] || 0) + 1;
                    }
                });

                // Generate dates
                for (var i = iDays - 1; i >= 0; i--) {
                    var d = new Date(oNow.getTime() - i * 24 * 60 * 60 * 1000);
                    var sKey = d.toISOString().substring(0, 10);
                    var sLabel = (d.getMonth() + 1) + "/" + d.getDate();
                    aResult.push({
                        label: sLabel,
                        value: oByGroup[sKey] || 0
                    });
                }
            } else if (sRange === "1Y") {
                // Monthly grouping for the last 12 months
                var oStart = new Date(oNow.getFullYear() - 1, oNow.getMonth() + 1, 1);
                var aMonths = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

                aItems.forEach(function (t) {
                    if (t.date >= oStart && t.date <= oNow) {
                        var sMonthKey = t.date.getFullYear() + "-" + (t.date.getMonth() < 9 ? "0" : "") + (t.date.getMonth() + 1);
                        oByGroup[sMonthKey] = (oByGroup[sMonthKey] || 0) + 1;
                    }
                });

                // Generate 12 months
                for (var i = 11; i >= 0; i--) {
                    var d = new Date(oNow.getFullYear(), oNow.getMonth() - i, 1);
                    var sKey = d.getFullYear() + "-" + (d.getMonth() < 9 ? "0" : "") + (d.getMonth() + 1);
                    var sLabel = aMonths[d.getMonth()] + " " + String(d.getFullYear()).substring(2);
                    aResult.push({
                        label: sLabel,
                        value: oByGroup[sKey] || 0
                    });
                }
            }

            return aResult;
        }

    });
});