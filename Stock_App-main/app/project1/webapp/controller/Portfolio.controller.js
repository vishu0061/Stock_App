sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageBox",
    "sap/m/MessageToast"
], function (Controller, JSONModel, MessageBox, MessageToast) {
    "use strict";

    return Controller.extend("sap.stocktrading.app.controller.Portfolio", {

        onInit: function () {
            const oVM = new JSONModel({
                customerName: "Demo Customer",
                holdings: [],
                transactions: [],
                summary: {
                    value: "—",
                    valueBadge: "Live",
                    valueSub: "Current portfolio market value",
                    pl: "—",
                    plBadge: "—",
                    plSub: "Unrealized across holdings",
                    plState: "Information",
                    holdings: "—",
                    holdingsBadge: "Holdings",
                    holdingsSub: "Stocks owned"
                }
            });
            this.getView().setModel(oVM, "pfVM");
            this._loadAll();
            this._applyChartStyle();
        },

        _applyChartStyle: function () {
            const oViz = this.byId("allocationChart");
            if (!oViz) return;
            oViz.setVizProperties({
                title: { visible: false },
                legend: {
                    visible: true,
                    label: { style: { color: "#94a3b8", fontFamily: "Inter" } }
                },
                plotArea: {
                    colorPalette: ["#10b981", "#38bdf8", "#a78bfa", "#fbbf24", "#ef4444", "#8b5cf6", "#ec4899"],
                    background: { visible: false },
                    dataLabel: {
                        visible: true,
                        style: { color: "#ffffff" },
                        hideWhenOverlap: true
                    }
                },
                background: { visible: false }
            });
        },

        // ================= BACK =================

        onNavBack: function () {

            window.history.go(-1);

        }

        ,

        onRefresh: function () {
            this._loadAll();
        },

        onGoMarket: function () {
            this.getOwnerComponent().getRouter().navTo("customer");
        },

        onSellFromPortfolio: function (oEvent) {
            const oCtx = oEvent.getSource().getBindingContext("pfVM");
            const o = oCtx && oCtx.getObject ? oCtx.getObject() : null;
            if (!o) return;

            const oInput = new sap.m.Input({ type: "Number", placeholder: "Enter quantity to sell" });
            const oDialog = new sap.m.Dialog({
                title: `Sell ${o.productName}`,
                contentWidth: "360px",
                content: [
                    new sap.m.VBox({
                        class: "sapUiMediumMargin",
                        items: [
                            new sap.m.Text({ text: `Owned: ${o.quantity}` }),
                            new sap.m.Text({ text: `Market: ${o.currency} ${o.currentPrice}` }),
                            new sap.m.Label({ text: "Quantity", class: "sapUiSmallMarginTop" }),
                            oInput
                        ]
                    })
                ],
                beginButton: new sap.m.Button({
                    text: "Confirm Sell",
                    type: "Reject",
                    press: async () => {
                        const iQty = parseInt(oInput.getValue(), 10);
                        if (!iQty || iQty <= 0) return MessageBox.error("Enter valid quantity");
                        if (iQty > o.quantity) return MessageBox.error("You cannot sell more than you own");

                        try {
                            const oVM = this.getView().getModel("pfVM");
                            const sCustomer = (oVM.getProperty("/customerName") || "Demo Customer").trim();
                            const oModel = this.getOwnerComponent().getModel();
                            const oAct = oModel.bindContext("/sellStock(...)");
                            oAct.setParameter("productId", o.productId);
                            oAct.setParameter("customerName", sCustomer);
                            oAct.setParameter("quantity", iQty);
                            const oRes = await oAct.execute();
                            const r = oRes && oRes.getObject ? oRes.getObject() : null;
                            if (!r) throw new Error("No response");
                            if (!r.success) return MessageBox.error(r.message || "Sell rejected");

                            MessageToast.show(r.message || "Sold");
                            await this._loadAll();
                            oDialog.close();
                        } catch (e) {
                            // eslint-disable-next-line no-console
                            console.error(e);
                            MessageBox.error("Sell failed (check roles / backend)");
                        }
                    }
                }),
                endButton: new sap.m.Button({ text: "Cancel", press: () => oDialog.close() }),
                afterClose: () => oDialog.destroy()
            });
            oDialog.open();
        },

        _loadAll: async function () {
            await Promise.all([this._loadHoldings(), this._loadTransactions()]);
            this._computeSummary();
        },

        _loadHoldings: async function () {
            const oVM = this.getView().getModel("pfVM");
            const sCustomer = (oVM.getProperty("/customerName") || "Demo Customer").trim();
            try {
                const oModel = this.getOwnerComponent().getModel();
                const oFn = oModel.bindContext("/getPortfolio(...)");
                oFn.setParameter("customerName", sCustomer);
                const oRes = await oFn.execute();
                const a = oRes && oRes.getObject ? oRes.getObject() : [];
                oVM.setProperty("/holdings", a || []);
            } catch (e) {
                // eslint-disable-next-line no-console
                console.error(e);
            }
        },

        _loadTransactions: async function () {
            const oVM = this.getView().getModel("pfVM");
            const sCustomer = (oVM.getProperty("/customerName") || "Demo Customer").trim();
            try {
                const oModel = this.getOwnerComponent().getModel();
                const oList = oModel.bindList("/Transactions", null, null, null, {
                    $filter: `customerName eq '${sCustomer.replace(/'/g, "''")}'`,
                    $expand: "product",
                    $orderby: "createdAt desc",
                    $top: 50
                });
                const aCtx = await oList.requestContexts();
                const a = aCtx.map((c) => {
                    const t = c.getObject();
                    return {
                        transactionType: t.transactionType,
                        productName: (t.product && t.product.productName) ? t.product.productName : (t.product_ID || ""),
                        quantity: t.quantity,
                        unitPrice: t.unitPrice,
                        totalPrice: t.totalPrice,
                        currency: (t.product && t.product.currency) ? t.product.currency : "",
                        createdAtText: t.createdAt ? new Date(t.createdAt).toLocaleString() : "",
                        status: t.status
                    };
                });
                oVM.setProperty("/transactions", a);
            } catch (e) {
                // eslint-disable-next-line no-console
                console.error(e);
            }
        },

        _computeSummary: function () {
            const oVM = this.getView().getModel("pfVM");
            const a = oVM.getProperty("/holdings") || [];
            const value = a.reduce((s, h) => s + Number(h.totalValue || 0), 0);
            const pl = a.reduce((s, h) => s + Number(h.profitLoss || 0), 0);

            oVM.setProperty("/summary/value", value.toFixed(2));
            oVM.setProperty("/summary/pl", `${pl >= 0 ? "+" : ""}${pl.toFixed(2)}`);
            oVM.setProperty("/summary/plBadge", `${pl >= 0 ? "Bullish" : "Bearish"}`);
            oVM.setProperty("/summary/plState", pl >= 0 ? "Success" : "Error");
            oVM.setProperty("/summary/plSub", "Unrealized across holdings");
            oVM.setProperty("/summary/holdings", `${a.length}`);
            oVM.setProperty("/summary/holdingsSub", `${a.length} stocks owned`);

            const sortedHoldings = [...a].sort((x, y) => Number(y.profitLoss || 0) - Number(x.profitLoss || 0));
            let topPerformers = [];
            if(sortedHoldings.length > 0) topPerformers.push(sortedHoldings[0]);
            if(sortedHoldings.length > 1) topPerformers.push(sortedHoldings[1]);
            if(sortedHoldings.length > 3) topPerformers.push(sortedHoldings[sortedHoldings.length - 2]);
            if(sortedHoldings.length > 2) topPerformers.push(sortedHoldings[sortedHoldings.length - 1]);
            topPerformers = [...new Set(topPerformers)];
            oVM.setProperty("/topPerformers", topPerformers);
        }

    });

});