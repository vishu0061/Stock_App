sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageBox",
    "sap/m/MessageToast"
], function (Controller, JSONModel, MessageBox, MessageToast) {
    "use strict";

    return Controller.extend("sap.stocktrading.app.controller.Portfolio", {

        /* ═══════════════════════════════════════════════════════
           INIT
        ═══════════════════════════════════════════════════════ */
        onInit: function () {
            /* ── Resolve customer name from URL hash or session ── */
            let sCustomerName = "Demo Customer";
            try {
                const sHash  = window.location.hash || "";
                const oMatch = sHash.match(/[?&]customer=([^&]+)/);
                if (oMatch) { sCustomerName = decodeURIComponent(oMatch[1]); }
            } catch (e) { /* ignore */ }

            const oVM = new JSONModel({
                customerName: sCustomerName,
                range: "1W",
                holdings: [],
                transactions: [],
                recentTransactions: [],
                notifications: [],
                summary: {
                    totalPortfolio:    "—",
                    portfolioPct:      "—",
                    portfolioPctState: "None",
                    totalPL:           "—",
                    plPct:             "—",
                    plState:           "None",
                    todaysGain:        "—",
                    invested:          "—",
                    balance:           "—",
                    stocksOwned:       "—",
                    stocksOwnedSub:    "Holdings"
                }
            });
            this.getView().setModel(oVM, "pfVM");
            this.getView().setModel(new JSONModel({ data: [] }), "pfChartModel");

            this._loadAll();

            // Route attach
            const oRouter = this.getOwnerComponent().getRouter();
            oRouter.getRoute("portfolio").attachPatternMatched(this._onRouteMatched, this);

            /* ── Auto-refresh every 10s to keep prices current ── */
            this._refreshTimer = setInterval(() => {
                this._loadAll();
            }, 10000);
        },

        _onRouteMatched: function () {
            this._loadAll();
        },

        onExit: function () {
            if (this._refreshTimer) {
                clearInterval(this._refreshTimer);
            }
        },

        /* ═══════════════════════════════════════════════════════
           NAVIGATION
        ═══════════════════════════════════════════════════════ */
        onNavBack: function () {
            this.getOwnerComponent().getRouter().navTo("customer");
        },

        onNotificationsPress: function () {
            MessageToast.show("Check the Notifications panel below ↓");
        },

        onStockSearch: function (oEvent) {
            const sQ = (oEvent.getParameter("query") || oEvent.getParameter("newValue") || "").trim();
            const oTable = this.byId("pfHoldingsTable");
            const oBinding = oTable && oTable.getBinding("items");
            if (!oBinding) { return; }
            if (sQ) {
                const oFilter = new sap.ui.model.Filter({
                    filters: [
                        new sap.ui.model.Filter("productName", sap.ui.model.FilterOperator.Contains, sQ),
                        new sap.ui.model.Filter("category", sap.ui.model.FilterOperator.Contains, sQ)
                    ],
                    and: false
                });
                oBinding.filter([oFilter]);
            } else {
                oBinding.filter([]);
            }
        },

        /* ═══════════════════════════════════════════════════════
           TIME RANGE CHANGE
        ═══════════════════════════════════════════════════════ */
        onPfTimeRangeChange: function (oEvent) {
            const sKey = oEvent.getParameter("key");
            this.getView().getModel("pfVM").setProperty("/range", sKey);
            this._buildPerformanceChart();
        },

        /* ═══════════════════════════════════════════════════════
           REFRESH
        ═══════════════════════════════════════════════════════ */
        onRefresh: function () {
            this._loadAll();
            MessageToast.show("Portfolio refreshed");
        },

        /* ═══════════════════════════════════════════════════════
           LOAD ALL DATA
        ═══════════════════════════════════════════════════════ */
        _loadAll: async function () {
            await Promise.all([
                this._loadHoldings(),
                this._loadTransactions()
            ]);
            this._computeSummary();
            this._buildPerformanceChart();
            this._buildNotifications();
            this._applyChartStyles();
        },

        /* ═══════════════════════════════════════════════════════
           LOAD HOLDINGS  (via /getPortfolio action)
        ═══════════════════════════════════════════════════════ */
        _loadHoldings: async function () {
            const oVM = this.getView().getModel("pfVM");
            const sCustomer = (oVM.getProperty("/customerName") || "Demo Customer").trim();
            try {
                const oModel = this.getOwnerComponent().getModel();
                const oFn = oModel.bindContext("/getPortfolio(...)");
                oFn.setParameter("customerName", sCustomer);
                await oFn.execute();
                const oBoundCtx = oFn.getBoundContext();
                let raw = oBoundCtx ? oBoundCtx.getObject() : [];
                // OData V4 function import may wrap result in { value: [...] }
                if (raw && raw.value && Array.isArray(raw.value)) { raw = raw.value; }
                if (!Array.isArray(raw)) { raw = []; }

                const a = raw.map(function (h) {
                    const buyPrice  = Number(h.avgBuyPrice || h.buyPrice || 0);
                    const currPrice = Number(h.currentPrice || h.price   || 0);
                    const qty       = Number(h.quantity     || 0);
                    const pl        = Number(h.profitLoss   || (currPrice - buyPrice) * qty || 0);
                    const plPct     = buyPrice > 0
                        ? parseFloat(((currPrice - buyPrice) / buyPrice * 100).toFixed(2))
                        : 0;
                    return {
                        productId:     h.productId   || h.product_ID || "",
                        productName:   h.productName || "—",
                        category:      h.category    || "General",
                        quantity:      qty,
                        buyPrice:      buyPrice.toFixed(2),
                        currentPrice:  currPrice.toFixed(2),
                        previousPrice: Number(h.previousPrice || currPrice),
                        totalValue:    Number(h.totalValue || currPrice * qty || 0),
                        profitLoss:    pl.toFixed(2),
                        profitLossPct: plPct,
                        currency:      h.currency || "INR",
                        initials:      (h.productName || "?").substring(0, 2).toUpperCase()
                    };
                });
                oVM.setProperty("/holdings", a);
            } catch (e) {
                console.error("Holdings load error:", e);
                oVM.setProperty("/holdings", []);
            }
        },

        /* ═══════════════════════════════════════════════════════
           LOAD TRANSACTIONS
        ═══════════════════════════════════════════════════════ */
        _loadTransactions: async function () {
            const oVM = this.getView().getModel("pfVM");
            const sCustomer = (oVM.getProperty("/customerName") || "Demo Customer").trim();
            try {
                const oModel = this.getOwnerComponent().getModel();
                /* Use proper OData V4 Filter objects — raw $filter strings are ignored by bindList */
                const oFilter = new sap.ui.model.Filter(
                    "customerName", sap.ui.model.FilterOperator.EQ, sCustomer
                );
                const oList = oModel.bindList("/Transactions", null,
                    [new sap.ui.model.Sorter("createdAt", true)],
                    [oFilter]
                );
                const aCtx = await oList.requestContexts(0, 100);
                const a = aCtx.map(function (c) {
                    const t = c.getObject();
                    /* product association is flattened as product_productName in OData V4 */
                    const sProductName = (t.product && t.product.productName)
                        ? t.product.productName
                        : (t.product_productName || t.productName || "Stock");
                    return {
                        transactionType: t.transactionType || "",
                        productName:     sProductName,
                        quantity:        t.quantity  || 0,
                        unitPrice:       Number(t.unitPrice  || 0).toFixed(2),
                        totalPrice:      Number(t.totalPrice || 0).toFixed(2),
                        currency:        (t.product && t.product.currency) ? t.product.currency : "₹",
                        createdAt:       t.createdAt || null,
                        createdAtText:   t.createdAt ? new Date(t.createdAt).toLocaleDateString("en-IN") : "",
                        status:          t.status || "COMPLETED"
                    };
                });
                oVM.setProperty("/transactions",       a);
                oVM.setProperty("/recentTransactions", a.slice(0, 5));
            } catch (e) {
                console.error("Transactions load error:", e);
                oVM.setProperty("/transactions",       []);
                oVM.setProperty("/recentTransactions", []);
            }
        },

        /* ═══════════════════════════════════════════════════════
           COMPUTE SUMMARY
        ═══════════════════════════════════════════════════════ */
        _computeSummary: function () {
            const oVM       = this.getView().getModel("pfVM");
            const aHoldings = oVM.getProperty("/holdings") || [];
            const aTx       = oVM.getProperty("/transactions") || [];

            /* ─────────────────────────────────────────────
             * Filter to a single primary currency to avoid mixing
             * INR + USD + EUR into one nonsensical total.
             * We pick INR (the dominant currency in the seed data).
             * USD / EUR holdings are shown in the table with their own currency.
             * ───────────────────────────────────────────── */
            const sPrimary  = "INR";
            const aINR      = aHoldings.filter(function (h) { return (h.currency || "INR") === sPrimary; });
            const aAll      = aHoldings; // used for counts

            const totalValue    = aINR.reduce(function (s, h) { return s + Number(h.totalValue  || 0); }, 0);
            const totalCost     = aINR.reduce(function (s, h) {
                return s + Number(h.buyPrice || 0) * Number(h.quantity || 0);
            }, 0);
            const totalPL       = aINR.reduce(function (s, h) { return s + Number(h.profitLoss || 0); }, 0);

            /* Portfolio growth %: how much the market value moved vs cost basis */
            const portGrowthPct = totalCost > 0
                ? parseFloat(((totalValue - totalCost) / totalCost * 100).toFixed(2))
                : 0;

            /* P/L %: same as portGrowthPct when using unrealized P/L */
            const plPct = portGrowthPct;

            /* ── Available Balance: computed from real transaction cash-flow ──
             * currency field on mapped transactions stores the product currency CODE
             * (INR / USD / EUR). Only count INR transactions against the INR wallet. */
            const startingCapital = 1000000; // ₹10,00,000 virtual wallet
            let cashOutflow = 0;
            let cashInflow  = 0;
            aTx.forEach(function (t) {
                /* Skip foreign-currency transactions (USD, EUR, etc.) */
                const cur = (t.currency || "INR").toUpperCase();
                if (cur !== "INR" && cur !== "₹") { return; }
                const amt = Number(t.totalPrice || 0);
                if (t.transactionType === "BUY")  { cashOutflow += amt; }
                if (t.transactionType === "SELL") { cashInflow  += amt; }
            });
            const availBal = Math.max(0, startingCapital - cashOutflow + cashInflow);

            /* ── Today's Gain: use previousPrice from getPortfolio result ──
             * This is the real intraday movement = (current - previous) × qty
             * for all INR holdings. Much more reliable than tx-date matching. */
            const todaysGain = aINR.reduce(function (s, h) {
                const curr  = Number(h.currentPrice || 0);
                const prev  = Number(h.previousPrice || curr);
                return s + (curr - prev) * Number(h.quantity || 0);
            }, 0);

            const fmt = (num) => Number(num).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            const profitable = aAll.filter(function (h) { return Number(h.profitLoss) > 0; }).length;

            oVM.setProperty("/summary/totalPortfolio",    "₹" + fmt(totalValue));
            oVM.setProperty("/summary/portfolioPct",      (portGrowthPct >= 0 ? "+" : "") + portGrowthPct.toFixed(2) + "%");
            oVM.setProperty("/summary/portfolioPctState", portGrowthPct >= 0 ? "Success" : "Error");
            oVM.setProperty("/summary/totalPL",           (totalPL >= 0 ? "+" : "-") + "₹" + fmt(Math.abs(totalPL)));
            oVM.setProperty("/summary/plPct",             (plPct >= 0 ? "+" : "") + plPct.toFixed(2) + "%");
            oVM.setProperty("/summary/plState",           plPct >= 0 ? "Success" : "Error");
            oVM.setProperty("/summary/todaysGain",        (todaysGain >= 0 ? "+" : "-") + "₹" + fmt(Math.abs(todaysGain)));
            oVM.setProperty("/summary/invested",          "₹" + fmt(totalCost));
            oVM.setProperty("/summary/balance",           "₹" + fmt(availBal));
            oVM.setProperty("/summary/stocksOwned",       aAll.length + " Holdings");
            oVM.setProperty("/summary/stocksOwnedSub",    profitable + " profitable");
        },

        /* ═══════════════════════════════════════════════════════
           BUILD PERFORMANCE CHART DATA
        ═══════════════════════════════════════════════════════ */
        _buildPerformanceChart: function () {
            const oVM      = this.getView().getModel("pfVM");
            const sRange   = oVM.getProperty("/range") || "1W";
            const aTx      = oVM.getProperty("/transactions") || [];
            const aHoldings = oVM.getProperty("/holdings") || [];

            if (aTx.length === 0) {
                /* No transactions yet — show empty chart cleanly */
                this.getView().getModel("pfChartModel").setProperty("/data", []);
                return;
            }

            /* Determine date window from the range selector */
            const now = new Date();
            let dFrom = new Date(now);
            if      (sRange === "1D")  { dFrom.setDate(dFrom.getDate() - 1); }
            else if (sRange === "1W")  { dFrom.setDate(dFrom.getDate() - 7); }
            else if (sRange === "1M")  { dFrom.setMonth(dFrom.getMonth() - 1); }
            else if (sRange === "1Y")  { dFrom.setFullYear(dFrom.getFullYear() - 1); }
            else                       { dFrom = new Date(0); } // ALL

            /*
             * Build a daily portfolio cost-basis snapshot:
             * For each day from dFrom→today, track:
             *   - cumulative invested capital (BUY) or released capital (SELL)
             * and derive a portfolio cost line.
             * We use running invested total as proxy for value (no PriceHistory join needed here).
             */
            const oByDate = {};
            aTx.forEach(function (t) {
                if (!t.createdAt) { return; }
                const d = new Date(t.createdAt);
                if (d < dFrom) { return; }
                const sKey = d.toLocaleDateString("en-IN");
                if (!oByDate[sKey]) { oByDate[sKey] = { buyCost: 0, sellRevenue: 0 }; }
                if (t.transactionType === "BUY")  { oByDate[sKey].buyCost     += Number(t.totalPrice || 0); }
                if (t.transactionType === "SELL") { oByDate[sKey].sellRevenue += Number(t.totalPrice || 0); }
            });

            /* Build a sorted running total */
            const aSortedDates = Object.keys(oByDate).sort(function (a, b) {
                return new Date(a) - new Date(b);
            });

            let runningInvested = 0;
            const aData = aSortedDates.map(function (d) {
                runningInvested += oByDate[d].buyCost - oByDate[d].sellRevenue;
                return {
                    time : d,
                    value: parseFloat(Math.max(0, runningInvested).toFixed(2))
                };
            });

            /*
             * Append a "today" point reflecting the current live portfolio value
             * so the chart endpoint always shows current market value, not just cost.
             */
            const totalValue = aHoldings.reduce(function (s, h) { return s + Number(h.totalValue || 0); }, 0);
            if (totalValue > 0) {
                const sToday = now.toLocaleDateString("en-IN");
                const lastEntry = aData[aData.length - 1];
                if (!lastEntry || lastEntry.time !== sToday) {
                    aData.push({ time: sToday, value: parseFloat(totalValue.toFixed(2)) });
                } else {
                    lastEntry.value = parseFloat(totalValue.toFixed(2));
                }
            }

            this.getView().getModel("pfChartModel").setProperty("/data", aData);
        },

        /* ═══════════════════════════════════════════════════════
           BUILD NOTIFICATIONS
        ═══════════════════════════════════════════════════════ */
        _buildNotifications: function () {
            const oVM       = this.getView().getModel("pfVM");
            const aHoldings = oVM.getProperty("/holdings") || [];
            const notifs    = [];

            aHoldings.forEach(function (h) {
                const pct = Number(h.profitLossPct || 0);
                if (pct > 5) {
                    notifs.push({ type: "gain", message: h.productName + " stock gained +" + pct + "%" });
                } else if (pct < -3) {
                    notifs.push({ type: "loss", message: h.productName + " stock dropped " + pct + "%" });
                }
            });

            const aTx = oVM.getProperty("/transactions") || [];
            if (aTx.length > 0) {
                notifs.push({ type: "wallet", message: "Last transaction: " + aTx[0].transactionType + " " + aTx[0].productName });
            }

            const totalValue = aHoldings.reduce(function (s, h) { return s + Number(h.totalValue || 0); }, 0);
            if (totalValue > 100000) {
                notifs.push({ type: "gain", message: "Portfolio crossed ₹1,00,000 milestone! 🎉" });
            }

            notifs.push({ type: "info", message: "Market volatility is normal — stay invested." });

            oVM.setProperty("/notifications", notifs.slice(0, 6));
        },

        /* ═══════════════════════════════════════════════════════
           CHART STYLES
        ═══════════════════════════════════════════════════════ */
        _applyChartStyles: function () {
            // Performance line chart
            const oPerf = this.byId("pfPerfChart");
            if (oPerf) {
                oPerf.setVizProperties({
                    title:   { visible: false },
                    legend:  { visible: false },
                    categoryAxis: {
                        title:    { visible: false },
                        label:    { style: { color: "#94a3b8", fontFamily: "Inter" } },
                        gridLine: { visible: false },
                        axisLine: { visible: true, color: "rgba(255,255,255,0.08)" }
                    },
                    valueAxis: {
                        title:    { visible: false },
                        label:    { style: { color: "#94a3b8", fontFamily: "Inter" } },
                        gridLine: { visible: true, color: "rgba(255,255,255,0.05)", size: 1 },
                        axisLine: { visible: false }
                    },
                    plotArea: {
                        background:   { visible: false },
                        dataLabel:    { visible: false },
                        colorPalette: ["#00ffaa"],
                        line:         { marker: { visible: false }, width: 3 }
                    },
                    background: { visible: false }
                });
            }

            // Donut allocation chart
            const oDonut = this.byId("pfAllocationChart");
            if (oDonut) {
                oDonut.setVizProperties({
                    title:   { visible: false },
                    legend: {
                        visible: true,
                        label:   { style: { color: "#94a3b8", fontFamily: "Inter" } }
                    },
                    plotArea: {
                        colorPalette: ["#10b981", "#38bdf8", "#a78bfa", "#fbbf24", "#ef4444", "#8b5cf6"],
                        background:   { visible: false },
                        dataLabel: {
                            visible:          true,
                            type:             "percentage",
                            style:            { color: "#ffffff" },
                            hideWhenOverlap:  true
                        }
                    },
                    background: { visible: false }
                });
            }
        },

        /* ═══════════════════════════════════════════════════════
           BUY FROM HOLDING
        ═══════════════════════════════════════════════════════ */
        onBuyFromHolding: function (oEvent) {
            const oCtx = oEvent.getSource().getBindingContext("pfVM");
            const o    = oCtx && oCtx.getObject ? oCtx.getObject() : null;
            if (!o) return;
            this._openBuyDialog(o);
        },

        _openBuyDialog: function (o) {
            const oQtyInput = new sap.m.Input({ type: "Number", placeholder: "Enter quantity" });
            const oTotalTxt = new sap.m.Text({ text: "Total: " + o.currency + " 0.00" });

            oQtyInput.attachLiveChange(function () {
                const qty = parseInt(oQtyInput.getValue(), 10) || 0;
                oTotalTxt.setText("Total: " + o.currency + " " + (qty * Number(o.currentPrice)).toFixed(2));
            });

            const oDialog = new sap.m.Dialog({
                title:        "Buy " + o.productName,
                contentWidth: "380px",
                resizable:    false,
                draggable:    true,
                content: [
                    new sap.m.VBox({
                        class: "sapUiMediumMargin",
                        items: [
                            new sap.m.Label({ text: "Current Price" }),
                            new sap.m.Title({ text: o.currency + " " + o.currentPrice, level: "H4", class: "sapUiTinyMarginBottom" }),
                            new sap.m.Label({ text: "Quantity", class: "sapUiSmallMarginTop" }),
                            oQtyInput,
                            oTotalTxt
                        ]
                    })
                ],
                beginButton: new sap.m.Button({
                    text: "Confirm Buy",
                    type: "Emphasized",
                    icon: "sap-icon://add",
                    press: async () => {
                        const iQty = parseInt(oQtyInput.getValue(), 10);
                        if (!iQty || iQty <= 0) return MessageBox.error("Enter a valid quantity.");
                        try {
                            const oVM       = this.getView().getModel("pfVM");
                            const sCustomer = (oVM.getProperty("/customerName") || "Demo Customer").trim();
                            const oModel    = this.getOwnerComponent().getModel();
                            const oAct      = oModel.bindContext("/buyStock(...)");
                            oAct.setParameter("productId",    o.productId);
                            oAct.setParameter("customerName", sCustomer);
                            oAct.setParameter("quantity",     iQty);
                            await oAct.execute();
                            const oBoundCtx = oAct.getBoundContext();
                            let r = oBoundCtx ? oBoundCtx.getObject() : null;
                            if (r && r.value !== undefined) { r = r.value; }
                            if (!r)         throw new Error("No response");
                            if (!r.success) return MessageBox.error(r.message || "Buy rejected");
                            MessageToast.show(r.message || "Bought successfully!");
                            await this._loadAll();
                            oDialog.close();
                        } catch (e) {
                            console.error(e);
                            MessageBox.error("Buy failed. Please try again.");
                        }
                    }
                }),
                endButton: new sap.m.Button({ text: "Cancel", press: () => oDialog.close() }),
                afterClose: () => oDialog.destroy()
            });
            this.getView().addDependent(oDialog);
            oDialog.open();
        },

        /* ═══════════════════════════════════════════════════════
           SELL FROM HOLDING
        ═══════════════════════════════════════════════════════ */
        onSellFromHolding: function (oEvent) {
            const oCtx = oEvent.getSource().getBindingContext("pfVM");
            const o    = oCtx && oCtx.getObject ? oCtx.getObject() : null;
            if (!o) return;
            this._openSellDialog(o);
        },

        _openSellDialog: function (o) {
            const oQtyInput  = new sap.m.Input({ type: "Number", placeholder: "Enter quantity to sell" });
            const oPlText    = new sap.m.Text({ text: "Profit / Loss: " + o.currency + " 0.00" });

            oQtyInput.attachLiveChange(function () {
                const qty = parseInt(oQtyInput.getValue(), 10) || 0;
                const pl  = (Number(o.currentPrice) - Number(o.buyPrice)) * qty;
                oPlText.setText("Profit / Loss: " + (pl >= 0 ? "+" : "") + o.currency + " " + pl.toFixed(2));
            });

            const oDialog = new sap.m.Dialog({
                title:        "Sell " + o.productName,
                contentWidth: "380px",
                resizable:    false,
                draggable:    true,
                content: [
                    new sap.m.VBox({
                        class: "sapUiMediumMargin",
                        items: [
                            new sap.m.Label({ text: "Owned Quantity" }),
                            new sap.m.Title({ text: String(o.quantity), level: "H4", class: "sapUiTinyMarginBottom" }),
                            new sap.m.Label({ text: "Sell Value" }),
                            new sap.m.Title({ text: o.currency + " " + o.currentPrice + " / share", level: "H5", class: "sapUiTinyMarginBottom" }),
                            new sap.m.Label({ text: "Quantity", class: "sapUiSmallMarginTop" }),
                            oQtyInput,
                            oPlText
                        ]
                    })
                ],
                beginButton: new sap.m.Button({
                    text: "Confirm Sell",
                    type: "Reject",
                    icon: "sap-icon://less",
                    press: async () => {
                        const iQty = parseInt(oQtyInput.getValue(), 10);
                        if (!iQty || iQty <= 0)  return MessageBox.error("Enter a valid quantity.");
                        if (iQty > o.quantity)    return MessageBox.error("Cannot sell more than you own (" + o.quantity + ").");
                        try {
                            const oVM       = this.getView().getModel("pfVM");
                            const sCustomer = (oVM.getProperty("/customerName") || "Demo Customer").trim();
                            const oModel    = this.getOwnerComponent().getModel();
                            const oAct      = oModel.bindContext("/sellStock(...)");
                            oAct.setParameter("productId",    o.productId);
                            oAct.setParameter("customerName", sCustomer);
                            oAct.setParameter("quantity",     iQty);
                            await oAct.execute();
                            const oBoundCtx = oAct.getBoundContext();
                            let r = oBoundCtx ? oBoundCtx.getObject() : null;
                            if (r && r.value !== undefined) { r = r.value; }
                            if (!r)         throw new Error("No response");
                            if (!r.success) return MessageBox.error(r.message || "Sell rejected");
                            MessageToast.show(r.message || "Sold successfully!");
                            await this._loadAll();
                            oDialog.close();
                        } catch (e) {
                            console.error(e);
                            MessageBox.error("Sell failed. Please try again.");
                        }
                    }
                }),
                endButton: new sap.m.Button({ text: "Cancel", press: () => oDialog.close() }),
                afterClose: () => oDialog.destroy()
            });
            this.getView().addDependent(oDialog);
            oDialog.open();
        },

        /* ═══════════════════════════════════════════════════════
           VIEW HOLDING — navigate to price trends
        ═══════════════════════════════════════════════════════ */
        onViewHolding: function (oEvent) {
            const oCtx = oEvent.getSource().getBindingContext("pfVM");
            const o    = oCtx && oCtx.getObject ? oCtx.getObject() : null;
            if (!o) return;
            MessageToast.show("Viewing: " + o.productName);
        },

        /* ═══════════════════════════════════════════════════════
           ADD FUNDS DIALOG
        ═══════════════════════════════════════════════════════ */
        onAddFundsDialog: function () {
            const oAmtInput = new sap.m.Input({ type: "Number", placeholder: "Enter amount to add" });

            const oDialog = new sap.m.Dialog({
                title:        "Add Virtual Funds",
                contentWidth: "380px",
                resizable:    false,
                draggable:    true,
                content: [
                    new sap.m.VBox({
                        class: "sapUiMediumMargin",
                        items: [
                            new sap.m.Text({ text: "Add virtual funds to your StockTrade Pro wallet for paper trading.", class: "sapUiTinyMarginBottom" }),
                            new sap.m.Label({ text: "Enter Amount (₹)", class: "sapUiSmallMarginTop" }),
                            oAmtInput,
                            new sap.m.HBox({
                                class: "sapUiTinyMarginTop",
                                wrap:  "Wrap",
                                items: [
                                    new sap.m.Button({ text: "₹10,000",  type: "Transparent", press: function () { oAmtInput.setValue("10000");  } }),
                                    new sap.m.Button({ text: "₹25,000",  type: "Transparent", press: function () { oAmtInput.setValue("25000");  } }),
                                    new sap.m.Button({ text: "₹50,000",  type: "Transparent", press: function () { oAmtInput.setValue("50000");  } }),
                                    new sap.m.Button({ text: "₹1,00,000",type: "Transparent", press: function () { oAmtInput.setValue("100000"); } })
                                ]
                            })
                        ]
                    })
                ],
                beginButton: new sap.m.Button({
                    text: "+ Add Money",
                    type: "Emphasized",
                    icon: "sap-icon://add",
                    press: () => {
                        const iAmt = parseFloat(oAmtInput.getValue());
                        if (!iAmt || iAmt <= 0) return MessageBox.error("Enter a valid amount.");
                        MessageToast.show("₹" + iAmt.toLocaleString() + " added to your wallet!");
                        oDialog.close();
                    }
                }),
                endButton: new sap.m.Button({ text: "Cancel", press: () => oDialog.close() }),
                afterClose: () => oDialog.destroy()
            });
            this.getView().addDependent(oDialog);
            oDialog.open();
        }

    });
});