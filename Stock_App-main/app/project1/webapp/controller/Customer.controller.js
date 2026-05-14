sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "sap/m/MessageBox"
], function (
    Controller,
    JSONModel,
    MessageToast,
    MessageBox
) {
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

            // gentle auto-refresh
            setInterval(() => {
                const oTable = this.byId("stockTable");
                if (oTable && oTable.getBinding("items")) oTable.getBinding("items").refresh();
                this._refreshSelectedHistory();
            }, 7000);
        },

        // ================= NAVIGATION =================

        onNavBack: function () {

            window.history.go(-1);

        },

        // ================= PORTFOLIO PAGE =================

        onPortfolioPress: function () {

            this.getOwnerComponent()
                .getRouter()
                .navTo("portfolio");

        },

        onLoadPortfolio: function () {
            this._refreshPortfolioSummary();
        },

        onStockSearch: function (oEvent) {
            const sQ = (oEvent.getParameter("query") || "").trim().toLowerCase();
            const oTable = this.byId("stockTable");
            const oBinding = oTable && oTable.getBinding("items");
            if (!oBinding) return;
            // Minimal: refresh (server side search not configured); user can still scroll
            if (!sQ) oBinding.refresh();
            else oBinding.refresh();
        },

        onSelectProduct: function (oEvent) {
            const oItem = oEvent.getSource();
            const oCtx = oItem.getBindingContext();
            const o = oCtx && oCtx.getObject ? oCtx.getObject() : null;
            if (!o || !o.ID) return;

            this.getView().getModel("custVM").setProperty("/selectedProductId", o.ID);
            this._refreshSelectedHistory();
        },

        // ================= BUY STOCK =================

        onBuyStock: function (oEvent) {
            oEvent.cancelBubble();
            const oContext = oEvent.getSource().getBindingContext();
            const oData = oContext.getObject();
            this._openTradeDialog("BUY", oData);
        },

        // ================= SELL STOCK =================

        onSellStock: function (oEvent) {
            oEvent.cancelBubble();
            const oContext = oEvent.getSource().getBindingContext();
            const oData = oContext.getObject();
            this._openTradeDialog("SELL", oData);
        },

        onTimeRangeChange: function (oEvent) {
            const sKey = oEvent.getParameter("key");
            this.getView().getModel("custVM").setProperty("/range", sKey);
            this._refreshSelectedHistory();
        },

        _openTradeDialog: function (sType, oProduct) {
            const oInput = new sap.m.Input({ type: "Number", placeholder: "Enter quantity" });
            const oVM = this.getView().getModel("custVM");
            const sCustomer = (oVM.getProperty("/customerName") || "Demo Customer").trim();

            const sTitle = sType === "BUY" ? "Buy Stock" : "Sell Stock";
            const sIcon = sType === "BUY" ? "sap-icon://add" : "sap-icon://less";
            const oDialog = new sap.m.Dialog({
                title: sTitle,
                contentWidth: "360px",
                content: [
                    new sap.m.VBox({
                        class: "sapUiMediumMargin",
                        items: [
                            new sap.m.ObjectIdentifier({ title: oProduct.productName, text: `${oProduct.currency} ${oProduct.price}` }),
                            new sap.m.Text({ text: `Available: ${oProduct.stockQuantity}` }),
                            new sap.m.Label({ text: "Quantity", class: "sapUiSmallMarginTop" }),
                            oInput
                        ]
                    })
                ],
                beginButton: new sap.m.Button({
                    text: sType === "BUY" ? "Confirm Buy" : "Confirm Sell",
                    icon: sIcon,
                    type: "Emphasized",
                    press: async () => {
                        const iQty = parseInt(oInput.getValue(), 10);
                        if (!iQty || iQty <= 0) return MessageBox.error("Enter valid quantity");
                        if (sType === "BUY" && iQty > oProduct.stockQuantity) return MessageBox.error("Insufficient stock available");

                        try {
                            const oModel = this.getOwnerComponent().getModel();
                            const sAction = sType === "BUY" ? "/buyStock(...)" : "/sellStock(...)";
                            const oAct = oModel.bindContext(sAction);
                            oAct.setParameter("productId", oProduct.ID);
                            oAct.setParameter("customerName", sCustomer);
                            oAct.setParameter("quantity", iQty);
                            const oRes = await oAct.execute();
                            const r = oRes && oRes.getObject ? oRes.getObject() : null;
                            if (!r) throw new Error("No response");
                            if (!r.success) return MessageBox.error(r.message || "Trade rejected");

                            MessageToast.show(r.message || "Trade completed");
                            const oTable = this.byId("stockTable");
                            if (oTable && oTable.getBinding("items")) oTable.getBinding("items").refresh();
                            this._refreshPortfolioSummary();
                            this._refreshSelectedHistory();
                            oDialog.close();
                        } catch (e) {
                            // eslint-disable-next-line no-console
                            console.error(e);
                            MessageBox.error("Trade failed (check roles / backend)");
                        }
                    }
                }),
                endButton: new sap.m.Button({ text: "Cancel", type: "Transparent", press: () => oDialog.close() }),
                afterClose: () => oDialog.destroy()
            });
            oDialog.open();
        },

        _createChartModel: function () {
            this.getView().setModel(new JSONModel({ data: [] }), "chartModel");
        },

        _refreshSelectedHistory: async function () {
            const oVM = this.getView().getModel("custVM");
            const sPid = oVM.getProperty("/selectedProductId");
            if (!sPid) return;
            const sRange = oVM.getProperty("/range") || "1W";
            try {
                const oModel = this.getOwnerComponent().getModel();
                const oFn = oModel.bindContext("/getPriceHistory(...)");
                oFn.setParameter("productId", sPid);
                oFn.setParameter("range", sRange);
                const oRes = await oFn.execute();
                const a = oRes && oRes.getObject ? oRes.getObject() : [];
                const aData = (a || []).map((p) => ({
                    time: new Date(p.createdAt).toLocaleString(),
                    price: Number(p.price)
                }));
                this.getView().getModel("chartModel").setProperty("/data", aData);
            } catch (e) {
                // eslint-disable-next-line no-console
                console.error(e);
            }
        },

        _refreshPortfolioSummary: async function () {
            const oVM = this.getView().getModel("custVM");
            const sCustomer = (oVM.getProperty("/customerName") || "Demo Customer").trim();
            try {
                const oModel = this.getOwnerComponent().getModel();
                const oFn = oModel.bindContext("/getPortfolio(...)");
                oFn.setParameter("customerName", sCustomer);
                const oRes = await oFn.execute();
                const a = oRes && oRes.getObject ? oRes.getObject() : [];
                const totalValue = (a || []).reduce((sum, h) => sum + Number(h.totalValue || 0), 0);
                const totalPL = (a || []).reduce((sum, h) => sum + Number(h.profitLoss || 0), 0);
                const owned = (a || []).length;
                const profitable = (a || []).filter((h) => Number(h.profitLoss || 0) > 0).length;

                oVM.setProperty("/summary/portfolioValue", `${totalValue.toFixed(2)}`);
                oVM.setProperty("/summary/unrealizedText", `${totalPL >= 0 ? "+" : ""}${totalPL.toFixed(2)} unrealized`);
                oVM.setProperty("/summary/portfolioProgress", Math.min(100, Math.round((owned / 20) * 100)));
                oVM.setProperty("/summary/profitLoss", `${totalPL >= 0 ? "+" : ""}${totalPL.toFixed(2)}`);
                oVM.setProperty("/summary/profitProgress", Math.min(100, Math.round(Math.abs(totalPL) / 1000 * 100)));
                oVM.setProperty("/summary/buyingPower", "—");
                oVM.setProperty("/summary/buyingPowerProgress", 40);
                oVM.setProperty("/summary/ownedStocks", `${owned} Stocks`);
                oVM.setProperty("/summary/ownedStocksSub", `${profitable} profitable`);
                oVM.setProperty("/summary/ownedStocksProgress", Math.min(100, Math.round((profitable / Math.max(1, owned)) * 100)));
            } catch (e) {
                // eslint-disable-next-line no-console
                console.error(e);
            }
        }

    });

});