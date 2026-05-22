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
                var oModel = this.getOwnerComponent().getModel();
                if (oModel) {
                    oModel.refresh();
                }
            }.bind(this), 5000);
        },

        _stopPolling: function () {
            if (this._intervalId) {
                clearInterval(this._intervalId);
                this._intervalId = null;
            }
        },

        onExit: function () {
            this._stopPolling();
        },

        /* ═══ LOAD DATA ═══════════════════════════════════════════════════ */

        _loadDashboardData: async function () {
            try {
                var oModel = this.getOwnerComponent().getModel();

                var aProducts = await oModel.bindList("/Products").requestContexts(0, 1000);
                this.byId("statTotalStocks").setText(String(aProducts.length));

                var aTx = await oModel.bindList("/Transactions").requestContexts(0, 5000);
                var iBuyers = 0, iSellers = 0;
                aTx.forEach(function (c) {
                    var t = c.getObject().transactionType;
                    if (t === "BUY") { iBuyers++; }
                    if (t === "SELL") { iSellers++; }
                });

                this.byId("statTotalBuyers").setText(String(iBuyers));
                this.byId("statTotalSellers").setText(String(iSellers));

                var aDailyData = this._buildDailyData(aTx);
                this.getView().setModel(new JSONModel({ dailyData: aDailyData }), "dashboard");

                setTimeout(function () {
                    var oViz = this.byId("dailyTradeChart");
                    if (oViz) {
                        oViz.setVizProperties({
                            title: { text: "Daily Buys vs Sells" },
                            legend: { visible: true },
                            plotArea: {
                                dataLabel: { visible: false },
                                colorPalette: ["#059669", "#dc2626"],
                                line: { marker: { visible: true, size: 5 } }
                            },
                            categoryAxis: { title: { visible: true, text: "Date" } },
                            valueAxis: { title: { visible: true, text: "Transactions" } }
                        });
                    }
                }.bind(this), 400);

            } catch (e) {
                console.error("Dashboard load error:", e);
                MessageToast.show("Failed to load dashboard data");
            }
            /* ── Refresh admin notifications alongside dashboard ── */
            this._refreshAdminNotifications();
        },

        /* ═══ BUILD DAILY CHART DATA ═══════════════════════════════════════
           Groups transactions by calendar date.
           Fills gaps (inactive days) with buys:0, sells:0.
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

            var aDates = Object.keys(oByDate).sort();
            if (!aDates.length) { return []; }

            var oStart = new Date(aDates[0]);
            var oEnd = new Date(aDates[aDates.length - 1]);
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
                var oModel   = this.getOwnerComponent().getModel();

                /* ── Latest transactions (all customers) ── */
                var aTxCtx = await oModel
                    .bindList("/Transactions")
                    .requestContexts(0, 10);

                /* ── Low or OUT stock products ── */
                var aProdLow = await oModel
                    .bindList("/Products", null, null, [
                        new sap.ui.model.Filter("status", sap.ui.model.FilterOperator.EQ, "LOW")
                    ])
                    .requestContexts(0, 5);

                var aProdOut = await oModel
                    .bindList("/Products", null, null, [
                        new sap.ui.model.Filter("status", sap.ui.model.FilterOperator.EQ, "OUT")
                    ])
                    .requestContexts(0, 5);

                var aItems = [];

                /* Trade activity */
                aTxCtx.forEach(function (c) {
                    var t     = c.getObject();
                    var isBuy = t.transactionType === "BUY";
                    var when  = t.createdAt ? new Date(t.createdAt) : new Date();
                    var diff  = Date.now() - when.getTime();
                    var mins  = Math.floor(diff / 60000);
                    var sAgo  = "just now";
                    if (mins >= 1440) { sAgo = Math.floor(mins / 1440) + "d ago"; }
                    else if (mins >= 60) { sAgo = Math.floor(mins / 60) + "h ago"; }
                    else if (mins >= 1) { sAgo = mins + "m ago"; }

                    aItems.push({
                        type   : isBuy ? "buy" : "sell",
                        title  : isBuy ? "🟢 Buy Order" : "🔴 Sell Order",
                        message: (t.customerName || "Customer") + " — " + (t.quantity || 0) + " units",
                        time   : sAgo,
                        ts     : when.getTime()
                    });
                });

                /* Low stock alerts */
                aProdLow.forEach(function (c) {
                    var p = c.getObject();
                    aItems.push({
                        type   : "alert",
                        title  : "⚠️ Low Stock Warning",
                        message: p.productName + " — " + p.stockQuantity + " units remaining",
                        time   : "live",
                        ts     : Date.now() + 2
                    });
                });

                /* Out of stock */
                aProdOut.forEach(function (c) {
                    var p = c.getObject();
                    aItems.push({
                        type   : "out",
                        title  : "🛑 Out of Stock",
                        message: p.productName + " is completely sold out",
                        time   : "now",
                        ts     : Date.now() + 3
                    });
                });

                aItems.sort(function (a, b) { return b.ts - a.ts; });

                var prevItems = oAdminVM.getProperty("/notifications/items") || [];
                var prevCount = oAdminVM.getProperty("/notifications/unreadCount") || 0;
                var newCount  = Math.max(0, aItems.length - prevItems.length);

                oAdminVM.setProperty("/notifications/items",       aItems);
                oAdminVM.setProperty("/notifications/unreadCount", prevCount + newCount);

            } catch (e) {
                console.error("Admin notification refresh error:", e);
            }
        },

        onAdminNotificationsPress: function (oEvent) {
            var oAdminVM = this.getView().getModel("adminVM");
            var aItems   = (oAdminVM && oAdminVM.getProperty("/notifications/items")) || [];

            /* Mark all as read */
            if (oAdminVM) { oAdminVM.setProperty("/notifications/unreadCount", 0); }

            var oNotifModel = new JSONModel({ items: aItems });

            var oList = new sap.m.List({
                items: {
                    path    : "notif>/items",
                    template: new sap.m.CustomListItem({
                        content: [
                            new sap.m.HBox({
                                alignItems: "Center",
                                class     : "cdNotifItem",
                                items     : [
                                    new sap.m.VBox({
                                        class: "cdNotifDotWrap",
                                        items: [
                                            new sap.m.Text({
                                                text : "",
                                                class: {
                                                    path     : "notif>type",
                                                    formatter: function (sType) {
                                                        if (sType === "buy")   { return "cdNotifDot cdDotGreen"; }
                                                        if (sType === "sell")  { return "cdNotifDot cdDotRed"; }
                                                        if (sType === "alert") { return "cdNotifDot cdDotAmber"; }
                                                        if (sType === "out")   { return "cdNotifDot cdDotRed"; }
                                                        return "cdNotifDot cdDotBlue";
                                                    }
                                                }
                                            })
                                        ]
                                    }),
                                    new sap.m.VBox({
                                        class: "cdNotifContent",
                                        items: [
                                            new sap.m.HBox({
                                                justifyContent: "SpaceBetween",
                                                items: [
                                                    new sap.m.Title({ text: "{notif>title}",   level: "H6", class: "cdNotifTitle" }),
                                                    new sap.m.Text({  text: "{notif>time}",    class: "cdNotifTime" })
                                                ]
                                            }),
                                            new sap.m.Text({ text: "{notif>message}", class: "cdNotifMessage" })
                                        ]
                                    })
                                ]
                            })
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
                contentHeight: "440px",
                placement    : "Bottom",
                showHeader   : true,
                class        : "cdNotifPopover",
                content      : [ oList ],
                endButton    : new sap.m.Button({
                    text : "Clear All",
                    type : "Transparent",
                    press: function () {
                        if (oAdminVM) {
                            oAdminVM.setProperty("/notifications/items", []);
                            oAdminVM.setProperty("/notifications/unreadCount", 0);
                        }
                        oNotifModel.setProperty("/items", []);
                    }
                }),
                afterClose: function () {
                    if (self._oAdminNotifPopover) {
                        self._oAdminNotifPopover.destroy();
                        self._oAdminNotifPopover = null;
                    }
                }
            });

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
                title: "\ud83d\udcc8  " + oProduct.productName + " \u2014 Stock Price Graph",
                contentWidth: "680px",
                content: [oContentBox],
                endButton: new MButton({ text: "Close", type: "Transparent", press: function () { oDialog.close(); } }),
                afterClose: function () { oDialog.destroy(); }
            });
            oDialog.open();
        }

    });
});