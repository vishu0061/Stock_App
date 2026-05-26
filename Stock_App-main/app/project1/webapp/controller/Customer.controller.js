sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "sap/m/MessageBox"
], function (Controller, JSONModel, MessageToast, MessageBox) {
    "use strict";

    return Controller.extend("sap.stocktrading.app.controller.Customer", {

        onInit: function () {
            /* ── Resolve customer name from URL hash or session ── */
            let sCustomerName = "Demo Customer";
            try {
                const sHash = window.location.hash || "";
                const oMatch = sHash.match(/[?&]customer=([^&]+)/);
                if (oMatch) { sCustomerName = decodeURIComponent(oMatch[1]); }
            } catch (e) { /* ignore */ }

            const oVM = new JSONModel({
                customerName: sCustomerName,
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
                    profitLossPct: "—",
                    buyingPower: "—",
                    buyingPowerProgress: 0,
                    ownedStocks: "—",
                    ownedStocksSub: "—",
                    ownedStocksProgress: 0,
                    portfolioBadge: "Loading…",
                    portfolioBadgeState: "None",
                    profitBadge: "Loading…",
                    profitBadgeState: "None",
                    stocksBadge: "Loading…",
                    stocksBadgeState: "None"
                },
                holdings: [],
                recentActivity: [],
                graphStats: {
                    marketTrend: "—",
                    marketTrendIcon: "sap-icon://trend-up",
                    dayHigh: "—",
                    dayLow: "—",
                    volume: "—"
                },
                notifications: {
                    unreadCount: 0,
                    items: []
                },
                
                // NEW: Sector Based Movement Analytics properties
                sectorRange: "1D",
                selectedSectorFilter: "ALL",
                sectorList: [],
                sentiment: {
                    score: 0,
                    text: "LOADING",
                    textClass: "cdChangeStatus",
                    sentimentTrendMsg: "Analyzing market data...",
                    advancing: 0,
                    declining: 0,
                    unchanged: 0
                },
                marketInsights: [],
                sectorChartData: []
            });
            this.getView().setModel(oVM, "custVM");

            this._createChartModel();
            this._refreshPortfolioSummary();
            this._refreshRecentActivity();
            this._refreshNotifications();

            const oRouter = this.getOwnerComponent().getRouter();
            oRouter.getRoute("customer").attachPatternMatched(this._onRouteMatched, this);

            /* ── Load daily chart on init ─────────────────────── */
            this._refreshDailyChart();

            /* ── Apply Price Chart Style ──────────────────────── */
            this._applyPriceChartStyle();

            /* ── Initialize & Style Sector Analytics ──────────── */
            this._initSectorAnalytics();
            this._applySectorChartStyle();

            /* ── Auto-refresh everything every 7s ─────────────── */
            this._intervalId = setInterval(() => {
                const oTable = this.byId("stockTable");
                if (oTable && oTable.getBinding("items")) {
                    oTable.getBinding("items").refresh();
                }
                this._refreshSelectedHistory();
                this._refreshPortfolioSummary();
                this._refreshRecentActivity();
                this._refreshDailyChart();
                this._refreshNotifications();
            }, 7000);
        },

        onExit: function () {
            if (this._intervalId) {
                clearInterval(this._intervalId);
                this._intervalId = null;
            }
        },

        /* ═══════════════════════════════════════════════════════
           NAVIGATION
        ═══════════════════════════════════════════════════════ */

        onNavBack: function () {
            window.location.hash = "";
            this.getOwnerComponent().getRouter().navTo("home");
        },

        onProfileMenuPress: function (oEvent) {
            var oSource = oEvent.getSource();
            if (!this._oProfileSheet) {
                this._oProfileSheet = new sap.m.ActionSheet({
                    title: "Choose Action",
                    showCancelButton: true,
                    placement: "Bottom",
                    buttons: [
                        new sap.m.Button({
                            text: "Profile Information",
                            icon: "sap-icon://employee",
                            press: function () {
                                MessageToast.show("Viewing customer profile");
                            }
                        }),
                        new sap.m.Button({
                            text: "Account Settings",
                            icon: "sap-icon://action-settings",
                            press: function () {
                                MessageToast.show("Settings opening...");
                            }
                        }),
                        new sap.m.Button({
                            text: "Logout",
                            icon: "sap-icon://log",
                            type: "Reject",
                            press: this.onLogout.bind(this)
                        })
                    ]
                });
                this.getView().addDependent(this._oProfileSheet);
            }
            this._oProfileSheet.openBy(oSource);
        },

        onLogout: function () {
            MessageBox.confirm("Are you sure you want to logout?", {
                title: "Confirm Logout",
                actions: [MessageBox.Action.OK, MessageBox.Action.CANCEL],
                onClose: function (sAction) {
                    if (sAction === MessageBox.Action.OK) {
                        window.location.hash = "";
                        this.getOwnerComponent().getRouter().navTo("home");
                    }
                }.bind(this)
            });
        },

        onNotificationsPress: function (oEvent) {
            const oVM = this.getView().getModel("custVM");
            const sCustomer = (oVM.getProperty("/customerName") || "Demo Customer").trim();
            const aItems = oVM.getProperty("/notifications/items") || [];

            /* ── Snapshot the items for this popover session ── */
            const oNotifModel = new JSONModel({ items: aItems });

            const oList = new sap.m.List({
                items: {
                    path: "notif>/items",
                    template: new sap.m.CustomListItem({
                        type: "Active",
                        press: async (oEvt) => {
                            const oItemCtx = oEvt.getSource().getBindingContext("notif");
                            const sId = oItemCtx.getProperty("ID");
                            try {
                                const oModel = this.getOwnerComponent().getModel();
                                const oContext = oModel.bindContext(`/Notifications(${sId})`);
                                await oContext.getBoundContext().setProperty("isRead", true);
                                
                                MessageToast.show("Notification dismissed");
                                this._refreshNotifications();
                                if (this._oNotifPopover) {
                                    this._oNotifPopover.close();
                                }
                            } catch (err) {
                                console.error("Mark notification read error:", err);
                            }
                        },
                        content: [
                            new sap.m.HBox({
                                alignItems: "Center",
                                class: {
                                    path: "notif>type",
                                    formatter: function (sType) {
                                        let c = "cdNotifItem cdNotifUnread";
                                        if (sType === "buy") c += " cdColorBuy";
                                        else if (sType === "sell") c += " cdColorSell";
                                        else if (sType === "alert" || sType === "spike") c += " cdColorAlert";
                                        return c;
                                    }
                                },
                                items: [
                                    new sap.m.VBox({
                                        class: "cdNotifDotWrap",
                                        items: [
                                            new sap.m.Text({
                                                text: "",
                                                class: {
                                                    path: "notif>type",
                                                    formatter: function (sType) {
                                                        return sType === "buy" ? "cdNotifDot cdDotGreen" :
                                                            sType === "sell" ? "cdNotifDot cdDotRed" :
                                                                sType === "alert" ? "cdNotifDot cdDotAmber" :
                                                                    sType === "spike" ? "cdNotifDot cdDotAmber" :
                                                                        "cdNotifDot cdDotBlue";
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
                                                    new sap.m.Title({ text: "{notif>title}", level: "H6", class: "cdNotifTitle" }),
                                                    new sap.m.Text({ text: "{notif>time}", class: "cdNotifTime" })
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
                noDataText: "🎉 You're all caught up — no new activity!",
                showSeparators: "Inner"
            });

            oList.setModel(oNotifModel, "notif");

            /* ── Build the popover ── */
            if (this._oNotifPopover) {
                this._oNotifPopover.destroy();
                this._oNotifPopover = null;
            }

            this._oNotifPopover = new sap.m.Popover({
                title: "🔔 Notifications",
                contentWidth: "380px",
                contentHeight: "460px",
                placement: "Bottom",
                showHeader: true,
                class: "cdNotifPopover",
                content: [oList],
                endButton: new sap.m.Button({
                    text: "Clear All",
                    type: "Transparent",
                    press: async () => {
                        try {
                            const oModel = this.getOwnerComponent().getModel();
                            const oAct = oModel.bindContext("/clearAllNotifications(...)");
                            oAct.setParameter("customerName", sCustomer);
                            await oAct.execute();

                            oVM.setProperty("/notifications/items", []);
                            oVM.setProperty("/notifications/unreadCount", 0);
                            oNotifModel.setProperty("/items", []);
                            
                            MessageToast.show("All notifications cleared");
                            if (this._oNotifPopover) {
                                this._oNotifPopover.close();
                            }
                        } catch (err) {
                            console.error("Clear all notifications error:", err);
                        }
                    }
                }),
                afterClose: () => {
                    if (this._oNotifPopover) { this._oNotifPopover.destroy(); this._oNotifPopover = null; }
                }
            });

            this.getView().addDependent(this._oNotifPopover);
            const oSource = oEvent ? oEvent.getSource() : this.byId("customerBellBtn");
            this._oNotifPopover.openBy(oSource);
        },

        _onRouteMatched: function () {
            this._refreshPortfolioSummary();
            this._refreshSelectedHistory();
            this._refreshRecentActivity();
            const oTable = this.byId("stockTable");
            if (oTable && oTable.getBinding("items")) {
                oTable.getBinding("items").refresh();
            }
        },

        onPortfolioPress: function () {
            this.getOwnerComponent().getRouter().navTo("portfolio");
        },

        onLoadPortfolio: function () { this._refreshPortfolioSummary(); },

        onStockSearch: function (oEvent) {
            const sQ = (oEvent.getParameter("query") || oEvent.getParameter("newValue") || "").trim();
            const oTable = this.byId("stockTable");
            const oBinding = oTable && oTable.getBinding("items");
            if (!oBinding) { return; }
            if (sQ) {
                const oFilter = new sap.ui.model.Filter({
                    path: "productName",
                    operator: sap.ui.model.FilterOperator.Contains,
                    value1: sQ,
                    caseSensitive: false
                });
                oBinding.filter([oFilter]);
            } else {
                oBinding.filter([]);
            }
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
            const oSource = this.byId("customerProfileBtn") || (oEvent ? oEvent.getSource() : null);

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
            const oVM = this.getView().getModel("custVM");
            const sName = oVM.getProperty("/customerName") || "Demo Customer";

            /* Build initials — e.g. "Demo Customer" → "DC" */
            const sInitials = sName
                .split(" ")
                .map(function (w) { return w.charAt(0); })
                .join("")
                .substring(0, 2)
                .toUpperCase();

            const oDialog = new sap.m.Dialog({
                title: "My Profile",
                contentWidth: "400px",
                resizable: false,
                draggable: true,
                content: [
                    new sap.m.VBox({
                        class: "sapUiMediumMargin",
                        items: [

                            /* ── Avatar row ── */
                            new sap.m.HBox({
                                justifyContent: "Center",
                                class: "sapUiSmallMarginBottom",
                                items: [
                                    new sap.m.Avatar({
                                        displaySize: "L",
                                        displayShape: "Circle",
                                        initials: sInitials,
                                        backgroundColor: "Accent5"
                                    })
                                ]
                            }),

                            /* ── Name ── */
                            new sap.m.Title({
                                text: sName,
                                level: "H3",
                                textAlign: "Center",
                                class: "sapUiSmallMarginBottom"
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
                    text: "Close",
                    type: "Emphasized",
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
                    title: "Confirm Logout",
                    icon: MessageBox.Icon.WARNING,
                    actions: [MessageBox.Action.YES, MessageBox.Action.NO],
                    emphasizedAction: MessageBox.Action.YES,
                    onClose: function (sAction) {
                        if (sAction === MessageBox.Action.YES) {
                            MessageToast.show("Logging out… see you soon!");

                            setTimeout(function () {
                                window.location.hash = "";
                                self.getOwnerComponent().getRouter().navTo("home");
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
            const oData = oContext.getObject();
            this._openTradeDialog("BUY", oData);
        },

        /* ═══════════════════════════════════════════════════════
           SELL STOCK
        ═══════════════════════════════════════════════════════ */

        onSellStock: function (oEvent) {
            oEvent.cancelBubble();
            const oContext = oEvent.getSource().getBindingContext();
            const oData = oContext.getObject();
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
            const oCtx = oEvent.getSource().getBindingContext();
            const oData = oCtx.getObject();
            if (!oData || !oData.ID) { return; }

            const oVM = this.getView().getModel("custVM");
            let aWatchlist = oVM.getProperty("/watchlist") || [];

            if (aWatchlist.includes(oData.ID)) {
                aWatchlist = aWatchlist.filter(function (id) { return id !== oData.ID; });
                MessageToast.show(oData.productName + " removed from Watchlist");
            } else {
                aWatchlist.push(oData.ID);
                MessageToast.show(oData.productName + " added to Watchlist");
            }

            oVM.setProperty("/watchlist", aWatchlist);
            oVM.updateBindings(true);
            this._refreshWatchlistData();
        },

        onRemoveWatchlist: function (oEvent) {
            const oCtx = oEvent.getSource().getBindingContext("custVM");
            const oData = oCtx.getObject();
            if (!oData || !oData.ID) { return; }

            const oVM = this.getView().getModel("custVM");
            let aWatchlist = oVM.getProperty("/watchlist") || [];
            aWatchlist = aWatchlist.filter(function (id) { return id !== oData.ID; });
            oVM.setProperty("/watchlist", aWatchlist);
            oVM.updateBindings(true);
            this._refreshWatchlistData();
        },

        onBuyFromWatchlist: function (oEvent) {
            const oCtx = oEvent.getSource().getBindingContext("custVM");
            const oData = oCtx.getObject();
            const oProduct = {
                ID: oData.ID,
                productName: oData.productName,
                currency: oData.currency,
                price: oData.price,
                stockQuantity: oData.stockQuantity || 100
            };
            this._openTradeDialog("BUY", oProduct);
        },

        _refreshWatchlistData: function () {
            const oVM = this.getView().getModel("custVM");
            const aWatchlist = oVM.getProperty("/watchlist") || [];

            if (aWatchlist.length === 0) {
                oVM.setProperty("/watchlistData", []);
                return;
            }

            const oTable = this.byId("stockTable");
            const oBinding = oTable.getBinding("items");
            if (!oBinding) { return; }

            const aContexts = oBinding.getCurrentContexts();
            const aData = [];

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
            const oInput = new sap.m.Input({ type: "Number", placeholder: "Enter quantity" });
            const oVM = this.getView().getModel("custVM");
            const sCustomer = (oVM.getProperty("/customerName") || "Demo Customer").trim();

            const oDialog = new sap.m.Dialog({
                title: sType === "BUY" ? "Buy Stock" : "Sell Stock",
                contentWidth: "360px",
                content: [
                    new sap.m.VBox({
                        class: "sapUiMediumMargin",
                        items: [
                            new sap.m.ObjectIdentifier({
                                title: oProduct.productName,
                                text: oProduct.currency + " " + oProduct.price
                            }),
                            new sap.m.Text({ text: "Available: " + oProduct.stockQuantity }),
                            new sap.m.Label({ text: "Quantity", class: "sapUiSmallMarginTop" }),
                            oInput
                        ]
                    })
                ],
                beginButton: new sap.m.Button({
                    text: sType === "BUY" ? "Confirm Buy" : "Confirm Sell",
                    icon: sType === "BUY" ? "sap-icon://add" : "sap-icon://less",
                    type: "Emphasized",
                    press: async () => {
                        const iQty = parseInt(oInput.getValue(), 10);
                        if (!iQty || iQty <= 0) {
                            return MessageBox.error("Enter valid quantity");
                        }
                        if (sType === "BUY" && iQty > oProduct.stockQuantity) {
                            return MessageBox.error("Insufficient stock available");
                        }

                        try {
                            const oModel = this.getOwnerComponent().getModel();
                            const sAction = sType === "BUY" ? "/buyStock(...)" : "/sellStock(...)";
                            const oAct = oModel.bindContext(sAction);
                            oAct.setParameter("productId", oProduct.ID);
                            oAct.setParameter("customerName", sCustomer);
                            oAct.setParameter("quantity", iQty);

                            await oAct.execute();
                            const oBoundCtx = oAct.getBoundContext();
                            let r = oBoundCtx ? oBoundCtx.getObject() : null;
                            if (r && r.value !== undefined) { r = r.value; }
                            if (!r) { throw new Error("No response"); }
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
                            this._refreshRecentActivity();

                            oDialog.close();

                        } catch (e) {
                            console.error(e);
                            MessageBox.error("Trade failed (check roles / backend)");
                        }
                    }
                }),
                endButton: new sap.m.Button({
                    text: "Cancel",
                    type: "Transparent",
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
                const aTx = await oModel
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
                if (t.transactionType === "BUY") { oByDate[sDate].buys++; }
                if (t.transactionType === "SELL") { oByDate[sDate].sells++; }
            });

            const aDates = Object.keys(oByDate).sort();

            const oToday = new Date();
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
                    date: (d.getMonth() + 1) + "/" + d.getDate(),
                    buys: (oByDate[sKey] || {}).buys || 0,
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
                title: { visible: false },
                legend: { visible: false },
                categoryAxis: {
                    title: { visible: false },
                    label: { style: { color: "#94a3b8", fontFamily: "Inter" } },
                    gridLine: { visible: false },
                    axisLine: { visible: true, color: "rgba(255,255,255,0.1)" }
                },
                valueAxis: {
                    title: { visible: false },
                    label: { style: { color: "#94a3b8", fontFamily: "Inter" } },
                    gridLine: { visible: true, color: "rgba(255,255,255,0.05)", size: 1 },
                    axisLine: { visible: false }
                },
                plotArea: {
                    background: { visible: false },
                    dataLabel: { visible: false },
                    colorPalette: ["#00ffaa"],
                    line: { marker: { visible: false }, width: 3 }
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
            const oVM = this.getView().getModel("custVM");
            const sPid = oVM.getProperty("/selectedProductId");
            if (!sPid) { return; }
            const sRange = oVM.getProperty("/range") || "1W";
            try {
                const oModel = this.getOwnerComponent().getModel();
                const oFn = oModel.bindContext("/getPriceHistory(...)");
                oFn.setParameter("productId", sPid);
                oFn.setParameter("range", sRange);
                const oRes = await oFn.execute();
                const a = oRes && oRes.getObject ? oRes.getObject() : [];
                const aData = (a || []).map(function (p) {
                    return {
                        time: new Date(p.createdAt).toLocaleString(),
                        price: Number(p.price)
                    };
                });
                this.getView().getModel("chartModel").setProperty("/data", aData);
                /* Refresh graph stats (day high/low/volume) for the selected stock */
                this._refreshGraphStats(sPid);
            } catch (e) {
                console.error(e);
            }
        },

        /* ═══════════════════════════════════════════════════════
           PORTFOLIO SUMMARY
        ═══════════════════════════════════════════════════════ */

        _refreshPortfolioSummary: async function () {
            const oVM = this.getView().getModel("custVM");
            const sCustomer = (oVM.getProperty("/customerName") || "Demo Customer").trim();
            try {
                const oModel = this.getOwnerComponent().getModel();
                const oFn = oModel.bindContext("/getPortfolio(...)");
                oFn.setParameter("customerName", sCustomer);
                await oFn.execute();
                const oBoundCtx = oFn.getBoundContext();
                let a = oBoundCtx ? oBoundCtx.getObject() : [];
                // OData V4 function import may wrap result in { value: [...] }
                if (a && a.value && Array.isArray(a.value)) { a = a.value; }
                if (!Array.isArray(a)) { a = []; }

                /* Filter to INR only for summary totals — avoid mixing INR+USD+EUR */
                const aINR = a.filter(function (h) { return (h.currency || "INR") === "INR"; });
                const owned = a.length;
                const profitable = a.filter(function (h) { return Number(h.profitLoss || 0) > 0; }).length;

                const totalValue = aINR.reduce(function (s, h) { return s + Number(h.totalValue || 0); }, 0);
                const totalPL = aINR.reduce(function (s, h) { return s + Number(h.profitLoss || 0); }, 0);
                const totalInv = aINR.reduce(function (s, h) { return s + (Number(h.avgBuyPrice || 0) * Number(h.quantity || 0)); }, 0);

                const fmt = (num) => Number(num).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                const startingCapital = 1000000; // ₹10,00,000 virtual wallet

                /* Available Balance from real transaction cash-flow */
                let cashOut = 0, cashIn = 0;
                try {
                    const oTxFilter = new sap.ui.model.Filter("customerName", sap.ui.model.FilterOperator.EQ, sCustomer);
                    const oTxList = oModel.bindList("/Transactions", null, [], [oTxFilter]);
                    const aTxCtx = await oTxList.requestContexts(0, 200);
                    aTxCtx.forEach(function (c) {
                        const t = c.getObject();
                        const amt = Number(t.totalPrice || 0);
                        if (t.transactionType === "BUY") { cashOut += amt; }
                        if (t.transactionType === "SELL") { cashIn += amt; }
                    });
                } catch (txErr) {
                    /* Fallback to cost-basis estimate if tx fetch fails */
                    cashOut = totalInv;
                }
                const availBal = Math.max(0, startingCapital - cashOut + cashIn);

                /* ── P/L percentage relative to total invested ── */
                const plPct = totalInv > 0 ? (totalPL / totalInv) * 100 : 0;
                const plPctStr = (plPct >= 0 ? "+" : "") + plPct.toFixed(2) + "%";
                const plState = plPct >= 0 ? "Success" : "Error";

                /* ── Portfolio growth % based on buying power used ── */
                const portPct = totalInv > 0 ? ((totalValue - totalInv) / totalInv) * 100 : 0;
                const portPctStr = (portPct >= 0 ? "+" : "") + portPct.toFixed(2) + "%";
                const portState = portPct >= 0 ? "Success" : "Error";

                /* ── Stocks badge: how many added this month ── */
                const stocksBadge = owned > 0 ? owned + " active" : "No holdings";

                oVM.setProperty("/summary/portfolioValue", "₹" + fmt(totalValue));
                oVM.setProperty("/summary/unrealizedText", (totalPL >= 0 ? "+" : "-") + "₹" + fmt(Math.abs(totalPL)) + " unrealized");
                oVM.setProperty("/summary/portfolioProgress", Math.min(100, Math.round((owned / 20) * 100)));
                oVM.setProperty("/summary/portfolioBadge", portPctStr);
                oVM.setProperty("/summary/portfolioBadgeState", portState);
                oVM.setProperty("/summary/profitLoss", (totalPL >= 0 ? "+" : "-") + "₹" + fmt(Math.abs(totalPL)));
                oVM.setProperty("/summary/profitLossPct", plPctStr);
                oVM.setProperty("/summary/profitProgress", Math.min(100, Math.abs(plPct)));
                oVM.setProperty("/summary/profitBadge", plPctStr);
                oVM.setProperty("/summary/profitBadgeState", plState);
                oVM.setProperty("/summary/buyingPower", "₹" + fmt(availBal));
                oVM.setProperty("/summary/buyingPowerProgress", Math.min(100, Math.round((availBal / startingCapital) * 100)));
                oVM.setProperty("/summary/ownedStocks", owned + " Stocks");
                oVM.setProperty("/summary/ownedStocksSub", profitable + " profitable");
                oVM.setProperty("/summary/ownedStocksProgress", Math.min(100, Math.round((profitable / Math.max(1, owned)) * 100)));
                oVM.setProperty("/summary/stocksBadge", stocksBadge);
                oVM.setProperty("/summary/stocksBadgeState", owned > 0 ? "Success" : "None");

                /* ── Update holdings list for portfolio breakdown ── */
                const fmt2 = (n) => Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                const maxTv = Math.max(1, totalValue);
                const aHoldings = a.map(function (h) {
                    const pl = Number(h.profitLoss || 0);
                    const plP = Number(h.profitLossPct || 0);
                    const tv = Number(h.totalValue || 0);
                    const curr = h.currency || "INR";
                    const sym = curr === "INR" ? "₹" : (curr === "USD" ? "$" : (curr === "EUR" ? "€" : curr + " "));
                    return {
                        productName: h.productName || "",
                        quantity: h.quantity || 0,
                        currency: curr,
                        currSymbol: sym,
                        currentPrice: fmt2(h.currentPrice || 0),
                        avgBuyPrice: fmt2(h.avgBuyPrice || 0),
                        totalValue: fmt2(tv),
                        profitLoss: (pl >= 0 ? "+" : "-") + sym + fmt2(Math.abs(pl)),
                        profitLossPct: (plP >= 0 ? "+" : "") + plP.toFixed(2) + "%",
                        plState: pl >= 0 ? "Success" : "Error",
                        barValue: curr === "INR" ? Math.min(100, Math.round((tv / maxTv) * 100)) : 10,
                        barState: pl >= 0 ? "Success" : "Error",
                        gainClass: pl >= 0 ? "cdChangeUp" : "cdChangeDown"
                    };
                });
                oVM.setProperty("/holdings", aHoldings);

            } catch (e) {
                console.error("Portfolio summary error:", e);
            }
        },

        /* ═══════════════════════════════════════════════════════
           RECENT ACTIVITY (real transactions)
        ═══════════════════════════════════════════════════════ */

        _refreshRecentActivity: async function () {
            const oVM = this.getView().getModel("custVM");
            const sCustomer = (oVM.getProperty("/customerName") || "Demo Customer").trim();
            try {
                const oModel = this.getOwnerComponent().getModel();
                const aTx = await oModel
                    .bindList("/Transactions", null, null, [
                        new sap.ui.model.Filter("customerName", sap.ui.model.FilterOperator.EQ, sCustomer)
                    ], { $orderby: "createdAt desc" })
                    .requestContexts(0, 8);

                const fmt = (num) => Number(num).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

                const aActivity = aTx.map(function (c) {
                    const t = c.getObject();
                    const isBuy = t.transactionType === "BUY";
                    const when = t.createdAt ? new Date(t.createdAt) : null;
                    let sAgo = "";
                    if (when) {
                        const diff = Date.now() - when.getTime();
                        const mins = Math.floor(diff / 60000);
                        if (mins < 1) { sAgo = "just now"; }
                        else if (mins < 60) { sAgo = mins + "m ago"; }
                        else if (mins < 1440) { sAgo = Math.floor(mins / 60) + "h ago"; }
                        else { sAgo = Math.floor(mins / 1440) + "d ago"; }
                    }
                    const productName = (t.product_productName || t.productName || "Stock");
                    return {
                        title: (isBuy ? "Bought " : "Sold ") + productName,
                        detail: t.quantity + " shares @ " + (t.currency || "₹") + fmt(t.unitPrice || 0),
                        time: sAgo,
                        dotClass: isBuy ? "cdActivityDot cdDotGreen" : "cdActivityDot cdDotRed"
                    };
                });

                oVM.setProperty("/recentActivity", aActivity);

            } catch (e) {
                console.error("Recent activity error:", e);
            }
        },

        /* ═══════════════════════════════════════════════════════════════
           REAL-TIME NOTIFICATIONS
           ─ Fetches live data from the OData service every 7 seconds.
           ─ Sources:
               1. /Transactions (customerName filter) → BUY/SELL confirmations
               2. /Products (status=LOW)              → low-stock alerts
               3. /HistoricalPrices (last 5 min)      → price spike alerts
               4. custVM>/holdings                    → portfolio milestones
           ─ Unread badge = # transaction notifications newer than _lastReadTs
        ═══════════════════════════════════════════════════════════════ */

        _refreshNotifications: async function () {
            const oVM = this.getView().getModel("custVM");
            const sCustomer = (oVM.getProperty("/customerName") || "Demo Customer").trim();

            try {
                const oModel = this.getOwnerComponent().getModel();
                const aCtx = await oModel
                    .bindList("/Notifications", null,
                        [new sap.ui.model.Sorter("createdAt", true)], // descending
                        [
                            new sap.ui.model.Filter("customerName", sap.ui.model.FilterOperator.EQ, sCustomer),
                            new sap.ui.model.Filter("isRead", sap.ui.model.FilterOperator.EQ, false)
                        ]
                    )
                    .requestContexts(0, 50);

                const aItems = aCtx.map(function (c) {
                    const n = c.getObject();
                    const when = n.createdAt ? new Date(n.createdAt) : new Date();
                    const tsMs = when.getTime();
                    const diff = Date.now() - tsMs;
                    const mins = Math.floor(diff / 60000);
                    let sAgo = "just now";
                    if (mins >= 1440) { sAgo = Math.floor(mins / 1440) + "d ago"; }
                    else if (mins >= 60) { sAgo = Math.floor(mins / 60) + "h ago"; }
                    else if (mins >= 1) { sAgo = mins + "m ago"; }

                    return {
                        ID: n.ID,
                        type: n.type || "info",
                        title: n.title || "Stock Alert",
                        message: n.message || "",
                        time: sAgo,
                        ts: tsMs
                    };
                });

                oVM.setProperty("/notifications/items", aItems);
                oVM.setProperty("/notifications/unreadCount", aItems.length);

            } catch (e) {
                console.error("Notifications refresh error:", e);
            }
        },

        _refreshGraphStats: async function (sPid) {
            if (!sPid) { return; }
            const oVM = this.getView().getModel("custVM");
            try {
                const oModel = this.getOwnerComponent().getModel();
                /* Use PriceHistory which is written by the real-time engine */
                const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
                const aCtx = await oModel
                    .bindList("/PriceHistory", null, null, [
                        new sap.ui.model.Filter("product_ID", sap.ui.model.FilterOperator.EQ, sPid),
                        new sap.ui.model.Filter("timestamp", sap.ui.model.FilterOperator.GE, oneDayAgo)
                    ])
                    .requestContexts(0, 5000);

                if (!aCtx || aCtx.length === 0) {
                    oVM.setProperty("/graphStats", { marketTrend: "No data", marketTrendIcon: "sap-icon://question-mark", dayHigh: "—", dayLow: "—", volume: "—" });
                    return;
                }

                let high = -Infinity, low = Infinity, vol = 0;
                aCtx.forEach(function (c) {
                    const r = c.getObject();
                    if (Number(r.high) > high) { high = Number(r.high); }
                    if (Number(r.low) < low) { low = Number(r.low); }
                    vol += Number(r.volume || 0);
                });

                const fmt2 = (n) => Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                const volStr = vol >= 1000000 ? (vol / 1000000).toFixed(1) + "M"
                    : vol >= 1000 ? (vol / 1000).toFixed(1) + "K"
                        : vol.toString();

                /* Determine trend from first vs last close */
                const firstClose = Number(aCtx[0].getObject().close || 0);
                const lastClose = Number(aCtx[aCtx.length - 1].getObject().close || 0);
                const isBull = lastClose >= firstClose;

                oVM.setProperty("/graphStats", {
                    marketTrend: isBull ? "Bullish" : "Bearish",
                    marketTrendIcon: isBull ? "sap-icon://trend-up" : "sap-icon://trend-down",
                    dayHigh: "₹" + fmt2(high),
                    dayLow: "₹" + fmt2(low),
                    volume: volStr
                });

            } catch (e) {
                console.error("Graph stats error:", e);
            }
        },

        /* ═══════════════════════════════════════════════════════
           SECTOR BASED MOVEMENT ANALYTICS METHODS (REAL-TIME DATA FETCHING)
        ═══════════════════════════════════════════════════════ */

        _initSectorAnalytics: function () {
            // Run dynamic refresh from live database records instantly
            this._refreshLiveSectorAnalytics();

            // Establish real-time updates every 2.5 seconds
            if (this._sectorTimer) { clearInterval(this._sectorTimer); }
            this._sectorTimer = setInterval(() => {
                this._refreshLiveSectorAnalytics();
            }, 2500);
        },

        _refreshLiveSectorAnalytics: async function () {
            const oVM = this.getView().getModel("custVM");
            if (!oVM) { return; }
            const oModel = this.getOwnerComponent().getModel();
            
            const SECTOR_COLOR_MAP = {
                "Technology": { hex: "#a78bfa", cssClass: "cdColorTech" },
                "Energy": { hex: "#fb923c", cssClass: "cdColorEnergy" },
                "Banking": { hex: "#10b981", cssClass: "cdColorBanking" },
                "Financial Services": { hex: "#10b981", cssClass: "cdColorBanking" },
                "Automotive": { hex: "#38bdf8", cssClass: "cdColorAuto" },
                "Automobile": { hex: "#38bdf8", cssClass: "cdColorAuto" }
            };
            try {
                // 1. Fetch live products from database via OData ListBinding
                const oListBinding = oModel.bindList("/Products", null, null, null, { $expand: "category" });
                const aCtx = await oListBinding.requestContexts(0, 100);
                
                if (!aCtx || aCtx.length === 0) { return; }
                const aProducts = aCtx.map(c => c.getObject());

                // 2. Group products by Category/Sector
                const oSectorsMap = {};
                aProducts.forEach(function (p) {
                    const sSectorName = p.category ? p.category.name : "Other";
                    if (!oSectorsMap[sSectorName]) {
                        oSectorsMap[sSectorName] = {
                            key: sSectorName,
                            name: sSectorName,
                            products: [],
                            changeSum: 0
                        };
                    }
                    oSectorsMap[sSectorName].products.push(p);
                    
                    // Daily change percentage of individual stock: ((price - previousPrice) / previousPrice) * 100
                    const fPrice = Number(p.price || 0);
                    const fPrev = Number(p.previousPrice || p.price || 1);
                    let fPct = 0;
                    if (fPrev > 0) {
                        fPct = ((fPrice - fPrev) / fPrev) * 100;
                    }
                    oSectorsMap[sSectorName].changeSum += fPct;
                });

                // 3. Build dynamic sector metadata array
                const aSectors = Object.keys(oSectorsMap).map(function (sName) {
                    const oSec = oSectorsMap[sName];
                    const fAvgChange = oSec.products.length > 0 ? (oSec.changeSum / oSec.products.length) : 0;
                    
                    let sIcon = "sap-icon://circle-task";
                    let sClass = "cdIconTeal";
                    let sDot = "cdMaterialsDot";
                    let sDesc = "Standard Sector";

                    if (sName === "Technology") {
                        sIcon = "sap-icon://laptop";
                        sClass = "cdIconPurple";
                        sDot = "cdTechDot";
                        sDesc = "High Growth • High Volatility";
                    } else if (sName === "Banking" || sName === "Financial Services") {
                        sIcon = "sap-icon://official-service";
                        sClass = "cdIconGreen";
                        sDot = "cdFinanceDot";
                        sDesc = "Stable Growth";
                    } else if (sName === "Energy") {
                        sIcon = "sap-icon://energy";
                        sClass = "cdIconYellow";
                        sDot = "cdEnergyDot";
                        sDesc = "High Volatility";
                    } else if (sName === "Automotive" || sName === "Automobile") {
                        sIcon = "sap-icon://cargo-train";
                        sClass = "cdIconBlue";
                        sDot = "cdHealthDot";
                        sDesc = "Cyclical • Moderate";
                    }
                    
                    const colorMap = SECTOR_COLOR_MAP[sName] || { hex: "#94a3b8", cssClass: "cdColorOther" };

                    const isUp = fAvgChange >= 0;
                    const sChangeText = (isUp ? "+" : "") + fAvgChange.toFixed(2) + "%";
                    const sChangeClass = isUp ? "cdChangeUp" : "cdChangeDown";
                    const sSparkIcon = isUp ? "sap-icon://trend-up" : "sap-icon://trend-down";

                    let sStatus = "Stable";
                    let sStatusState = "Success";
                    if (fAvgChange >= 1.5) { sStatus = "Strong"; }
                    else if (fAvgChange >= 0.5) { sStatus = "Positive"; }
                    else if (fAvgChange >= -0.2) { sStatus = "Stable"; }
                    else if (fAvgChange >= -1.0) { sStatus = "Neutral"; sStatusState = "Warning"; }
                    else { sStatus = "Weak"; sStatusState = "Error"; }

                    return {
                        key: oSec.key,
                        name: oSec.name,
                        description: sDesc,
                        change: parseFloat(fAvgChange.toFixed(2)),
                        changeText: sChangeText,
                        changeClass: sChangeClass,
                        icon: sIcon,
                        iconClass: sClass,
                        dotClass: sDot,
                        sparklineIcon: sSparkIcon,
                        status: sStatus,
                        statusState: sStatusState,
                        sectorColorHex: colorMap.hex,
                        sectorColorClass: colorMap.cssClass
                    };
                });

                // Prepended "All Sectors" object for dropdown select item mapping
                const aDropdownSectors = [
                    { key: "ALL", name: "All Sectors", dotClass: "cdAllDot", icon: "sap-icon://globe", iconClass: "cdIconTeal", changeText: "", sectorColorHex: "#ffffff", sectorColorClass: "cdColorAll" }
                ].concat(aSectors);
                oVM.setProperty("/sectorList", aDropdownSectors);

                const sSelectedFilter = oVM.getProperty("/selectedSectorFilter") || "ALL";
                const sSelectedRange = oVM.getProperty("/sectorRange") || "1D";

                // Filter sectors based on current selection
                const aFilteredSectors = sSelectedFilter === "ALL" 
                    ? aSectors 
                    : aSectors.filter(s => s.name === sSelectedFilter);

                oVM.setProperty("/filteredSectorList", aFilteredSectors);

                // Build dynamic Market Insights array based on the filtered sectors
                const aInsights = aFilteredSectors.map(function (s) {
                    const oSec = oSectorsMap[s.key];
                    const aProds = oSec.products || [];
                    
                    // Sort products by individual change pct
                    const aSortedProds = [...aProds].sort((a, b) => {
                        const chA = ((Number(a.price) - Number(a.previousPrice || a.price)) / Number(a.previousPrice || a.price || 1));
                        const chB = ((Number(b.price) - Number(b.previousPrice || b.price)) / Number(b.previousPrice || b.price || 1));
                        return chB - chA; // descending
                    });

                    const leadingStock = aSortedProds[0] ? aSortedProds[0].productName : "";
                    const laggingStock = aSortedProds[aSortedProds.length - 1] ? aSortedProds[aSortedProds.length - 1].productName : "";

                    let sStatus = "Neutral";
                    let sState = "Warning";
                    let sItemClass = "cdInsightNeutral";
                    let sDesc = "Mixed signals — wait for earnings report";

                    // Map change to status
                    if (s.change >= 0.5) {
                        sStatus = "Bullish";
                        sState = "Success";
                        sItemClass = "cdInsightBullish";
                        sDesc = "Strong momentum — " + (leadingStock ? leadingStock + " leading gains" : "sector rising");
                    } else if (s.change <= -0.5) {
                        sStatus = "Bearish";
                        sState = "Error";
                        sItemClass = "cdInsightBearish";
                        sDesc = "Downside pressure — " + (laggingStock ? laggingStock + " leading losses" : "sector declining");
                    }

                    // Map score between 10% and 95%
                    let fScore = 50 + (s.change * 10);
                    fScore = Math.min(95, Math.max(10, Math.round(fScore)));

                    return {
                        name: s.name + " Sector",
                        status: sStatus,
                        state: sState,
                        desc: sDesc,
                        score: fScore,
                        itemClass: sItemClass
                    };
                });
                oVM.setProperty("/marketInsights", aInsights);

                // 4. Update Sentiment analysis dynamically from actual sectors count
                const advancing = aSectors.filter(s => s.change > 0).length;
                const declining = aSectors.filter(s => s.change < 0).length;
                const unchanged = aSectors.length - advancing - declining;

                let score = 50 + (advancing - declining) * (aSectors.length > 0 ? Math.round(40 / aSectors.length) : 5);
                score = Math.min(95, Math.max(10, score));

                let sText = "NEUTRAL";
                let sTextClass = "cdChangeStatus";
                let sMsg = "Market is trending sideways";
                
                // Realtime bullish/bearish logic
                if (advancing > declining && advancing >= (aSectors.length / 2)) {
                    sText = "BULLISH";
                    sTextClass = "cdChangeUp";
                    sMsg = "Market is trending positive";
                } else if (declining > advancing && declining >= (aSectors.length / 2)) {
                    sText = "BEARISH";
                    sTextClass = "cdChangeDown";
                    sMsg = "Market is trending negative";
                } else if (score >= 60) {
                    sText = "BULLISH";
                    sTextClass = "cdChangeUp";
                    sMsg = "Market is trending positive";
                } else if (score <= 40) {
                    sText = "BEARISH";
                    sTextClass = "cdChangeDown";
                    sMsg = "Market is trending negative";
                }

                oVM.setProperty("/sentiment", {
                    score: score,
                    text: sText,
                    textClass: sTextClass,
                    sentimentTrendMsg: sMsg,
                    advancing: advancing,
                    declining: declining,
                    unchanged: unchanged,
                    totalSectors: aSectors.length
                });

                // 5. Append historical scrolling data point
                let aChartData = oVM.getProperty("/sectorChartData") || [];

                // Initialize historical walks if chart is empty, using the filtered array
                if (aChartData.length === 0) {
                    aChartData = this._generateSectorChartData(sSelectedRange, aFilteredSectors);
                }

                // Add live points for each active filtered sector
                const nowTime = new Date();
                const sTimeStr = nowTime.getHours().toString().padStart(2, '0') + ":" + 
                                 nowTime.getMinutes().toString().padStart(2, '0') + ":" + 
                                 nowTime.getSeconds().toString().padStart(2, '0');

                // Cap history length at last 15 time points to keep VizFrame snappy and beautiful
                const aTimes = [...new Set(aChartData.map(d => d.Time))];
                if (aTimes.length > 15) {
                    const oldestTime = aTimes[0];
                    aChartData = aChartData.filter(d => d.Time !== oldestTime);
                }

                aFilteredSectors.forEach(function (s) {
                    aChartData.push({
                        Time: sTimeStr,
                        Sector: s.name,
                        Performance: s.change
                    });
                });

                oVM.setProperty("/sectorChartData", aChartData);
                
                // Set permanent dynamic color palette for the filtered sectors exactly
                const dynamicPalette = aFilteredSectors.map(s => s.sectorColorHex);
                const oViz = this.byId("sectorMovementChart");
                if (oViz) {
                    oViz.setVizProperties({
                        plotArea: {
                            colorPalette: dynamicPalette
                        }
                    });
                }
                
                oVM.updateBindings(true);

            } catch (e) {
                console.error("Dynamic Sector fetching error:", e);
            }
        },

        _generateSectorChartData: function (sRange, aSectors) {
            let iCount = 15;
            let aLabels = [];
            if (sRange === "1D") {
                iCount = 15;
                for (let i = 0; i < iCount; i++) {
                    const h = 9 + Math.floor(i / 2);
                    const m = (i % 2) * 30;
                    aLabels.push(h.toString().padStart(2, '0') + ":" + m.toString().padStart(2, '0'));
                }
            } else if (sRange === "1W") {
                iCount = 7;
                aLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
            } else if (sRange === "1M") {
                iCount = 10;
                for (let i = 1; i <= iCount; i++) { aLabels.push("Day " + i); }
            } else {
                iCount = 8;
                for (let i = 1; i <= iCount; i++) { aLabels.push("Wk " + i); }
            }

            const aData = [];
            for (let i = 0; i < iCount; i++) {
                const sLabel = aLabels[i] || "";
                aSectors.forEach(function (s) {
                    const fFinal = s.change;
                    const fProgress = i / (iCount - 1);
                    const fWalk = fFinal * fProgress + (Math.sin(i * 1.5) * 0.3) * (1 - fProgress);
                    aData.push({
                        Time: sLabel,
                        Sector: s.name,
                        Performance: parseFloat(fWalk.toFixed(2))
                    });
                });
            }
            return aData;
        },

        _applySectorChartStyle: function () {
            const oViz = this.byId("sectorMovementChart");
            if (!oViz) { return; }
            oViz.setVizProperties({
                title: { visible: false },
                legend: { visible: false },
                categoryAxis: {
                    title: { visible: false },
                    label: { style: { color: "#94a3b8", fontFamily: "Inter" } },
                    gridLine: { visible: false },
                    axisLine: { visible: true, color: "rgba(255,255,255,0.1)" }
                },
                valueAxis: {
                    title: { visible: false },
                    label: {
                        style: { color: "#94a3b8", fontFamily: "Inter" },
                        formatString: "0.0'%'"
                    },
                    gridLine: { visible: true, color: "rgba(255,255,255,0.05)", size: 1 },
                    axisLine: { visible: false }
                },
                plotArea: {
                    background: { visible: false },
                    dataLabel: { visible: false },
                    colorPalette: ["#a78bfa", "#10b981", "#38bdf8", "#fb923c", "#2dd4bf", "#f472b6", "#fbbf24"],
                    line: { marker: { visible: false }, width: 2.5 }
                },
                background: { visible: false }
            });
        },

        onSectorRangeChange: function () {
            const oVM = this.getView().getModel("custVM");
            if (!oVM) { return; }
            
            // Clear current chart data to trigger regeneration of the selected range on next tick
            oVM.setProperty("/sectorChartData", []);
            this._refreshLiveSectorAnalytics();
        },

        onSectorFilterChange: function () {
            const oVM = this.getView().getModel("custVM");
            if (!oVM) { return; }
            
            // Clear chart data to trigger dynamic filter application in history building
            oVM.setProperty("/sectorChartData", []);
            this._refreshLiveSectorAnalytics();
        },

        onSectorTabPress: function (oEvent) {
            const oCtx = oEvent.getSource().getBindingContext("custVM");
            if (!oCtx) { return; }
            const sKey = oCtx.getProperty("key");
            
            const oVM = this.getView().getModel("custVM");
            oVM.setProperty("/selectedSectorFilter", sKey);
            
            // Clear chart data to trigger dynamic filter application in history building
            oVM.setProperty("/sectorChartData", []);
            this._refreshLiveSectorAnalytics();
        }

    });
});