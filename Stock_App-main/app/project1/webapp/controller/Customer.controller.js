sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "sap/m/MessageBox"
], function (Controller, JSONModel, MessageToast, MessageBox) {
    "use strict";

    return Controller.extend("sap.stocktrading.app.controller.Customer", {

        onInit: function () {
            const oVM = new JSONModel({
                customerName: "Demo Customer",
                range: "1W",
                selectedProductId: null,
                watchlist: [],
                watchlistData: [],
                summary: {
                    portfolioValue: "—",
                    unrealizedText: "—",
                    portfolioProgress: 0,
                    profitLoss: "—",
                    profitProgress: 0,
                    buyingPower: "—",
                    buyingPowerProgress: 0,
                    ownedStocks: "—",
                    ownedStocksSub: "—",
                    ownedStocksProgress: 0
                }
            });
            this.getView().setModel(oVM, "custVM");

            this._createChartModel();
            this._refreshPortfolioSummary();

            /* ── Load daily chart on init ─────────────────────── */
            this._refreshDailyChart();

            /* ── Apply Price Chart Style ──────────────────────── */
            this._applyPriceChartStyle();

            /* ── Auto-refresh table + charts every 7s ─────────── */
            setInterval(() => {
                const oTable = this.byId("stockTable");
                if (oTable && oTable.getBinding("items")) {
                    oTable.getBinding("items").refresh();
                }
                this._refreshSelectedHistory();
            }, 7000);
        },

        /* ═══════════════════════════════════════════════════════
           NAVIGATION
        ═══════════════════════════════════════════════════════ */

        onNavBack: function () { window.history.go(-1); },

        onNotificationsPress: function () { MessageToast.show("No new notifications"); },

        onPortfolioPress: function () {
            this.getOwnerComponent().getRouter().navTo("portfolio");
        },

        onLoadPortfolio: function () { this._refreshPortfolioSummary(); },

        onStockSearch: function (oEvent) {
            const sQ = (oEvent.getParameter("query") || "").trim().toLowerCase();
            const oTable = this.byId("stockTable");
            const oBinding = oTable && oTable.getBinding("items");
            if (!oBinding) { return; }
            oBinding.refresh();
        },

        onSelectProduct: function (oEvent) {
            const oCtx = oEvent.getSource().getBindingContext();
            const o = oCtx && oCtx.getObject ? oCtx.getObject() : null;
            if (!o || !o.ID) { return; }
            this.getView().getModel("custVM").setProperty("/selectedProductId", o.ID);
            this._refreshSelectedHistory();
        },

        onTimeRangeChange: function (oEvent) {
            const sKey = oEvent.getParameter("key");
            this.getView().getModel("custVM").setProperty("/range", sKey);
            this._refreshSelectedHistory();
        },

        /* ═══════════════════════════════════════════════════════
           PROFILE MENU — opens dropdown with My Profile + Logout
        ═══════════════════════════════════════════════════════ */

        onAvatarPress: function () {
            // kept for backward-compat — delegates to profile menu
            this.onProfileMenuPress();
        },

        onProfileMenuPress: function (oEvent) {
            const oView = this.getView();

            /* Create the sap.m.Menu only once and reuse it */
            if (!this._oProfileMenu) {
                this._oProfileMenu = new sap.m.Menu({
                    itemSelected: this.onProfileMenuItemSelected.bind(this)
                });

                this._oProfileMenu.addItem(
                    new sap.m.MenuItem({
                        text: "My Profile",
                        icon: "sap-icon://employee"
                    })
                );

                this._oProfileMenu.addItem(
                    new sap.m.MenuItem({
                        text: "Logout",
                        icon: "sap-icon://log"
                    })
                );

                oView.addDependent(this._oProfileMenu);
            }

            /* Anchor the popover to the profile button */
            const oSource = oEvent
                ? oEvent.getSource()
                : this.byId("customerProfileBtn");

            this._oProfileMenu.openBy(oSource);
        },

        onProfileMenuItemSelected: function (oEvent) {
            const sText = oEvent.getParameter("item").getText();

            if (sText === "My Profile") {
                this._openProfileDialog();
            } else if (sText === "Logout") {
                this._handleLogout();
            }
        },

        /* ═══════════════════════════════════════════════════════
           MY PROFILE DIALOG
        ═══════════════════════════════════════════════════════ */

        _openProfileDialog: function () {
            const oVM    = this.getView().getModel("custVM");
            const sName  = oVM.getProperty("/customerName") || "Demo Customer";

            /* Build initials — e.g. "Demo Customer" → "DC" */
            const sInitials = sName
                .split(" ")
                .map(function (w) { return w.charAt(0); })
                .join("")
                .substring(0, 2)
                .toUpperCase();

            const oDialog = new sap.m.Dialog({
                title       : "My Profile",
                contentWidth: "400px",
                resizable   : false,
                draggable   : true,
                content: [
                    new sap.m.VBox({
                        class: "sapUiMediumMargin",
                        items: [

                            /* ── Avatar row ── */
                            new sap.m.HBox({
                                justifyContent: "Center",
                                class         : "sapUiSmallMarginBottom",
                                items: [
                                    new sap.m.Avatar({
                                        displaySize    : "L",
                                        displayShape   : "Circle",
                                        initials       : sInitials,
                                        backgroundColor: "Accent5"
                                    })
                                ]
                            }),

                            /* ── Name ── */
                            new sap.m.Title({
                                text     : sName,
                                level    : "H3",
                                textAlign: "Center",
                                class    : "sapUiSmallMarginBottom"
                            }),

                            /* ── Info list ── */
                            new sap.m.List({
                                showSeparators: "Inner",
                                items: [
                                    new sap.m.DisplayListItem({
                                        label: "Role",
                                        value: "Customer / Trader"
                                    }),
                                    new sap.m.DisplayListItem({
                                        label: "Platform",
                                        value: "StockTrade Pro"
                                    }),
                                    new sap.m.DisplayListItem({
                                        label: "Account Status",
                                        value: "Active"
                                    }),
                                    new sap.m.DisplayListItem({
                                        label: "Session",
                                        value: new Date().toLocaleString()
                                    })
                                ]
                            })
                        ]
                    })
                ],

                /* ── Buttons ── */
                beginButton: new sap.m.Button({
                    text : "Close",
                    type : "Emphasized",
                    press: function () { oDialog.close(); }
                }),

                afterClose: function () { oDialog.destroy(); }
            });

            this.getView().addDependent(oDialog);
            oDialog.open();
        },

        /* ═══════════════════════════════════════════════════════
           LOGOUT
        ═══════════════════════════════════════════════════════ */

        _handleLogout: function () {
            const self = this;

            MessageBox.confirm(
                "Are you sure you want to logout from StockTrade Pro?",
                {
                    title           : "Confirm Logout",
                    icon            : MessageBox.Icon.WARNING,
                    actions         : [MessageBox.Action.YES, MessageBox.Action.NO],
                    emphasizedAction: MessageBox.Action.YES,
                    onClose         : function (sAction) {
                        if (sAction === MessageBox.Action.YES) {
                            MessageToast.show("Logging out… see you soon!");

                            setTimeout(function () {
                                /*
                                 * ── Option A (recommended for BTP / Launchpad):
                                 *    Navigate to your app's login route if you have one:
                                 *
                                 *    self.getOwnerComponent().getRouter().navTo("login");
                                 *
                                 * ── Option B (simple full-page reload, works universally):
                                 */
                                window.location.reload();

                            }, 1000);
                        }
                    }
                }
            );
        },

        /* ═══════════════════════════════════════════════════════
           BUY STOCK
        ═══════════════════════════════════════════════════════ */

        onBuyStock: function (oEvent) {
            oEvent.cancelBubble();
            const oContext = oEvent.getSource().getBindingContext();
            const oData    = oContext.getObject();
            this._openTradeDialog("BUY", oData);
        },

        /* ═══════════════════════════════════════════════════════
           SELL STOCK
        ═══════════════════════════════════════════════════════ */

        onSellStock: function (oEvent) {
            oEvent.cancelBubble();
            const oContext = oEvent.getSource().getBindingContext();
            const oData    = oContext.getObject();
            this._openTradeDialog("SELL", oData);
        },

        /* ═══════════════════════════════════════════════════════
           WATCHLIST
        ═══════════════════════════════════════════════════════ */

        formatWatchlistIcon: function (sId) {
            if (!sId) { return "sap-icon://add-favorite"; }
            const oVM = this.getView().getModel("custVM");
            if (!oVM) { return "sap-icon://add-favorite"; }
            const aWatchlist = oVM.getProperty("/watchlist") || [];
            return aWatchlist.includes(sId) ? "sap-icon://favorite" : "sap-icon://add-favorite";
        },

        onToggleWatchlist: function (oEvent) {
            oEvent.cancelBubble();
            const oCtx  = oEvent.getSource().getBindingContext();
            const oData = oCtx.getObject();
            if (!oData || !oData.ID) { return; }

            const oVM        = this.getView().getModel("custVM");
            let   aWatchlist = oVM.getProperty("/watchlist") || [];

            if (aWatchlist.includes(oData.ID)) {
                aWatchlist = aWatchlist.filter(function (id) { return id !== oData.ID; });
                MessageToast.show(oData.productName + " removed from Watchlist");
            } else {
                aWatchlist.push(oData.ID);
                MessageToast.show(oData.productName + " added to Watchlist");
            }

            oVM.setProperty("/watchlist", aWatchlist);
            this._refreshWatchlistData();
        },

        onRemoveWatchlist: function (oEvent) {
            const oCtx  = oEvent.getSource().getBindingContext("custVM");
            const oData = oCtx.getObject();
            if (!oData || !oData.ID) { return; }

            const oVM        = this.getView().getModel("custVM");
            let   aWatchlist = oVM.getProperty("/watchlist") || [];
            aWatchlist = aWatchlist.filter(function (id) { return id !== oData.ID; });
            oVM.setProperty("/watchlist", aWatchlist);
            this._refreshWatchlistData();
        },

        onBuyFromWatchlist: function (oEvent) {
            const oCtx  = oEvent.getSource().getBindingContext("custVM");
            const oData = oCtx.getObject();
            const oProduct = {
                ID           : oData.ID,
                productName  : oData.productName,
                currency     : oData.currency,
                price        : oData.price,
                stockQuantity: oData.stockQuantity || 100
            };
            this._openTradeDialog("BUY", oProduct);
        },

        _refreshWatchlistData: function () {
            const oVM        = this.getView().getModel("custVM");
            const aWatchlist = oVM.getProperty("/watchlist") || [];

            if (aWatchlist.length === 0) {
                oVM.setProperty("/watchlistData", []);
                return;
            }

            const oTable    = this.byId("stockTable");
            const oBinding  = oTable.getBinding("items");
            if (!oBinding) { return; }

            const aContexts = oBinding.getCurrentContexts();
            const aData     = [];

            aContexts.forEach(function (oCtx) {
                const oProduct = oCtx.getObject();
                if (aWatchlist.includes(oProduct.ID)) {
                    aData.push(oProduct);
                }
            });

            oVM.setProperty("/watchlistData", aData);
        },

        /* ═══════════════════════════════════════════════════════
           TRADE DIALOG
        ═══════════════════════════════════════════════════════ */

        _openTradeDialog: function (sType, oProduct) {
            const oInput    = new sap.m.Input({ type: "Number", placeholder: "Enter quantity" });
            const oVM       = this.getView().getModel("custVM");
            const sCustomer = (oVM.getProperty("/customerName") || "Demo Customer").trim();

            const oDialog = new sap.m.Dialog({
                title       : sType === "BUY" ? "Buy Stock" : "Sell Stock",
                contentWidth: "360px",
                content: [
                    new sap.m.VBox({
                        class: "sapUiMediumMargin",
                        items: [
                            new sap.m.ObjectIdentifier({
                                title: oProduct.productName,
                                text : oProduct.currency + " " + oProduct.price
                            }),
                            new sap.m.Text({ text: "Available: " + oProduct.stockQuantity }),
                            new sap.m.Label({ text: "Quantity", class: "sapUiSmallMarginTop" }),
                            oInput
                        ]
                    })
                ],
                beginButton: new sap.m.Button({
                    text : sType === "BUY" ? "Confirm Buy" : "Confirm Sell",
                    icon : sType === "BUY" ? "sap-icon://add" : "sap-icon://less",
                    type : "Emphasized",
                    press: async () => {
                        const iQty = parseInt(oInput.getValue(), 10);
                        if (!iQty || iQty <= 0) {
                            return MessageBox.error("Enter valid quantity");
                        }
                        if (sType === "BUY" && iQty > oProduct.stockQuantity) {
                            return MessageBox.error("Insufficient stock available");
                        }

                        try {
                            const oModel  = this.getOwnerComponent().getModel();
                            const sAction = sType === "BUY" ? "/buyStock(...)" : "/sellStock(...)";
                            const oAct    = oModel.bindContext(sAction);
                            oAct.setParameter("productId",    oProduct.ID);
                            oAct.setParameter("customerName", sCustomer);
                            oAct.setParameter("quantity",     iQty);

                            const oRes = await oAct.execute();
                            const r    = oRes && oRes.getObject ? oRes.getObject() : null;
                            if (!r)         { throw new Error("No response"); }
                            if (!r.success) { return MessageBox.error(r.message || "Trade rejected"); }

                            MessageToast.show(r.message || "Trade completed");

                            /* ── Refresh everything after trade ── */
                            const oTable = this.byId("stockTable");
                            if (oTable && oTable.getBinding("items")) {
                                oTable.getBinding("items").refresh();
                            }
                            this._refreshPortfolioSummary();
                            this._refreshSelectedHistory();
                            this._refreshDailyChart();

                            oDialog.close();

                        } catch (e) {
                            console.error(e);
                            MessageBox.error("Trade failed (check roles / backend)");
                        }
                    }
                }),
                endButton: new sap.m.Button({
                    text : "Cancel",
                    type : "Transparent",
                    press: () => oDialog.close()
                }),
                afterClose: () => oDialog.destroy()
            });

            oDialog.open();
        },

        /* ═══════════════════════════════════════════════════════
           DAILY CHART
        ═══════════════════════════════════════════════════════ */

        _refreshDailyChart: async function () {
            try {
                const oModel = this.getOwnerComponent().getModel();
                const aTx    = await oModel
                    .bindList("/Transactions")
                    .requestContexts(0, 5000);

                const aDaily = this._buildDailyData(aTx);

                let oChartM = this.getView().getModel("dailyChart");
                if (!oChartM) {
                    oChartM = new JSONModel({ rows: aDaily });
                    this.getView().setModel(oChartM, "dailyChart");
                } else {
                    oChartM.setProperty("/rows", aDaily);
                }

                this._applyDailyChartStyle();

            } catch (e) {
                console.error("Daily chart refresh error:", e);
            }
        },

        _buildDailyData: function (aTx) {
            const oByDate = {};

            aTx.forEach(function (c) {
                const t = c.getObject();
                if (!t || !t.createdAt) { return; }
                const sDate = String(t.createdAt).substring(0, 10);
                if (!oByDate[sDate]) { oByDate[sDate] = { buys: 0, sells: 0 }; }
                if (t.transactionType === "BUY")  { oByDate[sDate].buys++;  }
                if (t.transactionType === "SELL") { oByDate[sDate].sells++; }
            });

            const aDates = Object.keys(oByDate).sort();

            const oToday  = new Date();
            oToday.setHours(0, 0, 0, 0);

            let oStart = aDates.length
                ? new Date(aDates[0])
                : new Date(oToday.getTime() - 13 * 24 * 60 * 60 * 1000);

            const iDays = Math.round((oToday - oStart) / (24 * 60 * 60 * 1000));
            if (iDays > 60) {
                oStart = new Date(oToday.getTime() - 59 * 24 * 60 * 60 * 1000);
            }

            const aResult = [];
            for (let d = new Date(oStart); d <= oToday; d.setDate(d.getDate() + 1)) {
                const sKey = d.toISOString().substring(0, 10);
                aResult.push({
                    date : (d.getMonth() + 1) + "/" + d.getDate(),
                    buys : (oByDate[sKey] || {}).buys  || 0,
                    sells: (oByDate[sKey] || {}).sells || 0
                });
            }
            return aResult;
        },

        /* ═══════════════════════════════════════════════════════
           STYLE DAILY CHART
        ═══════════════════════════════════════════════════════ */

        _applyDailyChartStyle: function () {
            const oViz = this.byId("customerDailyChart");
            if (!oViz) { return; }
            oViz.setVizProperties({
                title: {
                    text : "Daily Buys vs Sells",
                    style: { color: "#ffffff", fontSize: "14px", fontWeight: "bold", fontFamily: "Inter" }
                },
                legend: {
                    visible: true,
                    label  : { style: { color: "#94a3b8", fontFamily: "Inter" } }
                },
                categoryAxis: {
                    title   : { visible: true, text: "Date", style: { color: "#94a3b8" } },
                    label   : { style: { color: "#94a3b8" } },
                    gridLine: { visible: false },
                    axisLine: { visible: true, color: "#334155" }
                },
                valueAxis: {
                    title   : { visible: true, text: "Transactions", style: { color: "#94a3b8" } },
                    label   : { style: { color: "#94a3b8" } },
                    gridLine: { visible: true, color: "rgba(255,255,255,0.05)", size: 1 },
                    axisLine: { visible: false }
                },
                plotArea: {
                    background  : { visible: false },
                    dataLabel   : { visible: false },
                    colorPalette: ["#10b981", "#ef4444"],
                    line        : { marker: { visible: true, size: 6 }, width: 3 }
                },
                background: { visible: false }
            });
        },

        /* ═══════════════════════════════════════════════════════
           STYLE PRICE CHART
        ═══════════════════════════════════════════════════════ */

        _applyPriceChartStyle: function () {
            const oViz = this.byId("priceChart");
            if (!oViz) { return; }
            oViz.setVizProperties({
                title  : { visible: false },
                legend : { visible: false },
                categoryAxis: {
                    title   : { visible: false },
                    label   : { style: { color: "#94a3b8", fontFamily: "Inter" } },
                    gridLine: { visible: false },
                    axisLine: { visible: true, color: "rgba(255,255,255,0.1)" }
                },
                valueAxis: {
                    title   : { visible: false },
                    label   : { style: { color: "#94a3b8", fontFamily: "Inter" } },
                    gridLine: { visible: true, color: "rgba(255,255,255,0.05)", size: 1 },
                    axisLine: { visible: false }
                },
                plotArea: {
                    background  : { visible: false },
                    dataLabel   : { visible: false },
                    colorPalette: ["#00ffaa"],
                    line        : { marker: { visible: false }, width: 3 }
                },
                background: { visible: false }
            });
        },

        /* ═══════════════════════════════════════════════════════
           CHART MODEL (price history)
        ═══════════════════════════════════════════════════════ */

        _createChartModel: function () {
            this.getView().setModel(new JSONModel({ data: [] }), "chartModel");
        },

        _refreshSelectedHistory: async function () {
            const oVM  = this.getView().getModel("custVM");
            const sPid = oVM.getProperty("/selectedProductId");
            if (!sPid) { return; }
            const sRange = oVM.getProperty("/range") || "1W";
            try {
                const oModel = this.getOwnerComponent().getModel();
                const oFn    = oModel.bindContext("/getPriceHistory(...)");
                oFn.setParameter("productId", sPid);
                oFn.setParameter("range",     sRange);
                const oRes  = await oFn.execute();
                const a     = oRes && oRes.getObject ? oRes.getObject() : [];
                const aData = (a || []).map(function (p) {
                    return {
                        time : new Date(p.createdAt).toLocaleString(),
                        price: Number(p.price)
                    };
                });
                this.getView().getModel("chartModel").setProperty("/data", aData);
            } catch (e) {
                console.error(e);
            }
        },

        /* ═══════════════════════════════════════════════════════
           PORTFOLIO SUMMARY
        ═══════════════════════════════════════════════════════ */

        _refreshPortfolioSummary: async function () {
            const oVM       = this.getView().getModel("custVM");
            const sCustomer = (oVM.getProperty("/customerName") || "Demo Customer").trim();
            try {
                const oModel = this.getOwnerComponent().getModel();
                const oFn    = oModel.bindContext("/getPortfolio(...)");
                oFn.setParameter("customerName", sCustomer);
                const oRes = await oFn.execute();
                const a    = oRes && oRes.getObject ? oRes.getObject() : [];

                const totalValue = (a || []).reduce(function (s, h) { return s + Number(h.totalValue  || 0); }, 0);
                const totalPL    = (a || []).reduce(function (s, h) { return s + Number(h.profitLoss  || 0); }, 0);
                const owned      = (a || []).length;
                const profitable = (a || []).filter(function (h) { return Number(h.profitLoss || 0) > 0; }).length;

                oVM.setProperty("/summary/portfolioValue",      totalValue.toFixed(2));
                oVM.setProperty("/summary/unrealizedText",      (totalPL >= 0 ? "+" : "") + totalPL.toFixed(2) + " unrealized");
                oVM.setProperty("/summary/portfolioProgress",   Math.min(100, Math.round((owned / 20) * 100)));
                oVM.setProperty("/summary/profitLoss",          (totalPL >= 0 ? "+" : "") + totalPL.toFixed(2));
                oVM.setProperty("/summary/profitProgress",      Math.min(100, Math.round(Math.abs(totalPL) / 1000 * 100)));
                oVM.setProperty("/summary/buyingPower",         "—");
                oVM.setProperty("/summary/buyingPowerProgress", 40);
                oVM.setProperty("/summary/ownedStocks",         owned + " Stocks");
                oVM.setProperty("/summary/ownedStocksSub",      profitable + " profitable");
                oVM.setProperty("/summary/ownedStocksProgress", Math.min(100, Math.round((profitable / Math.max(1, owned)) * 100)));
            } catch (e) {
                console.error(e);
            }
        }

    });
});