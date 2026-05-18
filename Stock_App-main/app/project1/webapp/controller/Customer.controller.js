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
 
        onAvatarPress: function () {
            const oVM = this.getView().getModel("custVM");
            MessageToast.show("Trading as: " + (oVM.getProperty("/customerName") || "Demo Customer"));
        },
 
        onPortfolioPress: function () {
            this.getOwnerComponent().getRouter().navTo("portfolio");
        },
 
        onLoadPortfolio: function () { this._refreshPortfolioSummary(); },
 
        onStockSearch: function (oEvent) {
            const sQ = (oEvent.getParameter("query") || "").trim().toLowerCase();
            const oTable = this.byId("stockTable");
            const oBinding = oTable && oTable.getBinding("items");
            if (!oBinding) { return; }
            if (!sQ) { oBinding.refresh(); } else { oBinding.refresh(); }
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
           TRADE DIALOG
           KEY CHANGE: after successful trade, also call
           _refreshDailyChart() so the graph updates immediately
        ═══════════════════════════════════════════════════════ */
 
        _openTradeDialog: function (sType, oProduct) {
            const oInput = new sap.m.Input({ type: "Number", placeholder: "Enter quantity" });
            const oVM    = this.getView().getModel("custVM");
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
 
                            /* ── Refresh everything after trade ──────── */
                            const oTable = this.byId("stockTable");
                            if (oTable && oTable.getBinding("items")) {
                                oTable.getBinding("items").refresh();
                            }
                            this._refreshPortfolioSummary();
                            this._refreshSelectedHistory();
 
                            /* ── KEY: refresh daily chart so today's
                                   buy/sell count updates immediately ──── */
                            this._refreshDailyChart();
 
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
           DAILY CHART — fetch all transactions, build daily
           buys/sells data, always end at TODAY
        ═══════════════════════════════════════════════════════ */
 
        _refreshDailyChart: async function () {
            try {
                const oModel = this.getOwnerComponent().getModel();
                const aTx    = await oModel
                    .bindList("/Transactions")
                    .requestContexts(0, 5000);
 
                const aDaily = this._buildDailyData(aTx);
 
                /* Set / update the dailyChart model */
                let oChartM = this.getView().getModel("dailyChart");
                if (!oChartM) {
                    oChartM = new JSONModel({ rows: aDaily });
                    this.getView().setModel(oChartM, "dailyChart");
                } else {
                    oChartM.setProperty("/rows", aDaily);
                }
 
                /* Re-apply viz properties after data update */
                this._applyDailyChartStyle();
 
            } catch (e) {
                console.error("Daily chart refresh error:", e);
            }
        },
 
        /* ═══════════════════════════════════════════════════════
           BUILD DAILY DATA
           - Groups transactions by date
           - Fills gaps with 0
           - Always ends at TODAY so current date is visible
        ═══════════════════════════════════════════════════════ */
 
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
 
            /* Always end at today */
            const oToday = new Date();
            oToday.setHours(0, 0, 0, 0);
 
            /* Start from first transaction, or 14 days ago if none */
            let oStart = aDates.length
                ? new Date(aDates[0])
                : new Date(oToday.getTime() - 13 * 24 * 60 * 60 * 1000);
 
            /* Cap at 60 days so chart stays readable */
            const iDays = Math.round((oToday - oStart) / (24 * 60 * 60 * 1000));
            if (iDays > 60) {
                oStart = new Date(oToday.getTime() - 59 * 24 * 60 * 60 * 1000);
            }
 
            const aResult = [];
            for (let d = new Date(oStart); d <= oToday; d.setDate(d.getDate() + 1)) {
                const sKey = d.toISOString().substring(0, 10);
                aResult.push({
                    date:  (d.getMonth() + 1) + "/" + d.getDate(),
                    buys:  (oByDate[sKey] || {}).buys  || 0,
                    sells: (oByDate[sKey] || {}).sells || 0
                });
            }
            return aResult;
        },
 
        /* ═══════════════════════════════════════════════════════
           STYLE DAILY CHART
           Green line = Buys, Red line = Sells
           Dark bg, white axis labels — matches screenshot
        ═══════════════════════════════════════════════════════ */
 
        _applyDailyChartStyle: function () {
            const oViz = this.byId("customerDailyChart");
            if (!oViz) { return; }
            oViz.setVizProperties({
                title: {
                    text: "Daily Buys vs Sells",
                    style: { color: "#ffffff", fontSize: "14px", fontWeight: "bold" }
                },
                legend: {
                    visible: true,
                    label: { style: { color: "#94a3b8" } }
                },
                categoryAxis: {
                    title: { visible: true, text: "Date", style: { color: "#94a3b8" } },
                    label: { style: { color: "#94a3b8" } },
                    gridLine: { visible: false },
                    axisLine:  { visible: true, color: "#334155" }
                },
                valueAxis: {
                    title: { visible: true, text: "Transactions", style: { color: "#94a3b8" } },
                    label: { style: { color: "#94a3b8" } },
                    gridLine: { visible: true, color: "#1e293b", size: 1 },
                    axisLine:  { visible: false }
                },
                plotArea: {
                    background:   { visible: false },
                    dataLabel:    { visible: false },
                    colorPalette: ["#10b981", "#ef4444"],
                    line: { marker: { visible: true, size: 6 }, width: 2 }
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
                const oRes = await oFn.execute();
                const a    = oRes && oRes.getObject ? oRes.getObject() : [];
                const aData = (a || []).map((p) => ({
                    time:  new Date(p.createdAt).toLocaleString(),
                    price: Number(p.price)
                }));
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
 
                const totalValue = (a || []).reduce((s, h) => s + Number(h.totalValue  || 0), 0);
                const totalPL    = (a || []).reduce((s, h) => s + Number(h.profitLoss  || 0), 0);
                const owned      = (a || []).length;
                const profitable = (a || []).filter((h) => Number(h.profitLoss || 0) > 0).length;
 
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