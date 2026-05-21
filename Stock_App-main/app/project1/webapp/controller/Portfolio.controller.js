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
                range: "1D",
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
                },
                analytics: {
                    bestPerfValue: "0.00%",
                    bestPerfTime: "—",
                    worstPerfValue: "0.00%",
                    worstPerfTime: "—",
                    breakEvenTime: "—",
                    breakEvenSub: "—",
                    totalFluctuation: "0.00%",
                    totalFluctuationSub: "—",
                    marketTrend: "Neutral",
                    marketTrendClass: "pfAnalyticsVal pfValWhite",
                    marketTrendIcon: "sap-icon://line-chart",
                    marketTrendIconClass: "pfAnalyticsTrendIcon pfValWhiteIcon",
                    marketTrendSub: "—"
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

            // Register global hover handlers for premium custom SVG portfolio performance chart
            window.tvPerfHover = function (evt, svgEl) {
                var rect = svgEl.getBoundingClientRect();
                var mouseX = evt.clientX - rect.left;
                var width = rect.width;
                var svgX = (mouseX / width) * 1000;
                
                var pts = window.tvPerfSvgPoints;
                var baseline = window.tvPerfSvgBaseline;
                if (!pts || pts.length === 0) return;
                
                var lMargin = 60;
                var rMargin = 120;
                var gWidth = 1000 - lMargin - rMargin;
                var nPoints = pts.length;
                
                var idx = Math.round(((svgX - lMargin) / gWidth) * (nPoints - 1));
                idx = Math.max(0, Math.min(nPoints - 1, idx));
                var pt = pts[idx];
                
                var vLine = svgEl.getElementById("tvPerfVLine");
                var dot = svgEl.getElementById("tvPerfDot");
                var tooltip = svgEl.parentNode.querySelector("#tvPerfTooltip");
                
                var ptX = lMargin + (idx / (nPoints - 1)) * gWidth;
                var ptY = pt.y;
                
                if (vLine) {
                    vLine.setAttribute("x1", ptX);
                    vLine.setAttribute("x2", ptX);
                    vLine.style.display = "block";
                }
                if (dot) {
                    dot.setAttribute("cx", ptX);
                    dot.setAttribute("cy", ptY);
                    dot.setAttribute("fill", pt.value >= baseline ? "#10b981" : "#ef4444");
                    dot.style.display = "block";
                }
                if (tooltip) {
                    tooltip.style.display = "block";
                    var clientPtX = (ptX / 1000) * rect.width;
                    var clientPtY = (ptY / 320) * rect.height;
                    
                    if (clientPtX > rect.width * 0.7) {
                        tooltip.style.left = (clientPtX - 190) + "px";
                    } else {
                        tooltip.style.left = (clientPtX + 20) + "px";
                    }
                    tooltip.style.top = (clientPtY - 80) + "px";
                    
                    tooltip.querySelector(".tt-time").innerText = pt.time;
                    var pct = pt.changePct;
                    tooltip.querySelector(".tt-val").innerText = (pct >= 0 ? "+" : "") + pct.toFixed(2) + "%";
                    tooltip.querySelector(".tt-val").style.color = pct >= 0 ? "#10b981" : "#ef4444";
                    tooltip.querySelector(".tt-port").innerText = "₹" + pt.value.toLocaleString("en-IN", {minimumFractionDigits: 2});
                    tooltip.querySelector(".tt-inv").innerText = "₹" + baseline.toLocaleString("en-IN", {minimumFractionDigits: 2});
                    
                    var diff = pt.value - baseline;
                    tooltip.querySelector(".tt-pl").innerText = (diff >= 0 ? "+" : "") + "₹" + diff.toLocaleString("en-IN", {minimumFractionDigits: 2});
                    tooltip.querySelector(".tt-pl").style.color = diff >= 0 ? "#10b981" : "#ef4444";
                }
            };
            
            window.tvPerfLeave = function (evt, svgEl) {
                var vLine = svgEl.getElementById("tvPerfVLine");
                var dot = svgEl.getElementById("tvPerfDot");
                var tooltip = svgEl.parentNode.querySelector("#tvPerfTooltip");
                if (vLine) vLine.style.display = "none";
                if (dot) dot.style.display = "none";
                if (tooltip) tooltip.style.display = "none";
            };
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
                if (t.transactionType === "SELL" || t.transactionType === "ADD_FUNDS") { cashInflow  += amt; }
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
           BUILD PERFORMANCE CHART DATA & SVG DRAWING
        ═══════════════════════════════════════════════════════ */
        _buildPerformanceChart: function () {
            const oVM      = this.getView().getModel("pfVM");
            const sRange   = oVM.getProperty("/range") || "1D";
            const aHoldings = oVM.getProperty("/holdings") || [];

            const sPrimary  = "INR";
            const aINR      = aHoldings.filter(function (h) { return (h.currency || "INR") === sPrimary; });

            let totalCost = aINR.reduce(function (s, h) {
                return s + Number(h.buyPrice || 0) * Number(h.quantity || 0);
            }, 0);
            let totalValue = aINR.reduce(function (s, h) {
                return s + Number(h.totalValue || 0);
            }, 0);

            let isDemo = false;
            if (totalCost === 0) {
                /* No active holdings — show mock portfolio demo */
                totalCost = 3473800;
                totalValue = 3841920;
                isDemo = true;
            }

            /* Determine number of points based on range */
            let n = 12;
            if      (sRange === "1H")  { n = 12; }
            else if (sRange === "1D")  { n = 24; }
            else if (sRange === "1W")  { n = 7; }
            else if (sRange === "1M")  { n = 15; }
            else if (sRange === "1Y")  { n = 12; }
            else                       { n = 20; }

            const aPoints = [];
            const now = new Date();

            // Pseudo-random seed generator based on range
            let seed = sRange.charCodeAt(0) + (sRange.charCodeAt(1) || 0) + 42;
            function prng() {
                let x = Math.sin(seed++) * 10000;
                return x - Math.floor(x);
            }

            const startRatio = 0.94 + prng() * 0.08; // start between 94% and 102% of baseline
            const endRatio = totalValue / totalCost;

            for (let i = 0; i < n; i++) {
                const t = i / (n - 1);
                const interpRatio = startRatio + (endRatio - startRatio) * t;
                
                // Add some organic Brownian wiggle
                let fluc = 0;
                if (i > 0 && i < n - 1) {
                    fluc = (prng() - 0.5) * 0.035 * Math.sin(Math.PI * t);
                }
                
                const value = totalCost * (interpRatio + fluc);
                
                // Format timestamp
                let sTimeLabel = "";
                if (sRange === "1H") {
                    const d = new Date(now.getTime() - (n - 1 - i) * 5 * 60 * 1000);
                    sTimeLabel = d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
                } else if (sRange === "1D") {
                    const d = new Date(now.getTime() - (n - 1 - i) * 30 * 60 * 1000);
                    sTimeLabel = d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
                } else if (sRange === "1W") {
                    const d = new Date(now.getTime() - (n - 1 - i) * 24 * 60 * 60 * 1000);
                    sTimeLabel = d.toLocaleDateString("en-IN", { weekday: "short" });
                } else if (sRange === "1M") {
                    const d = new Date(now.getTime() - (n - 1 - i) * 2 * 24 * 60 * 60 * 1000);
                    sTimeLabel = d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
                } else if (sRange === "1Y") {
                    const d = new Date(now.getTime() - (n - 1 - i) * 30 * 24 * 60 * 60 * 1000);
                    sTimeLabel = d.toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
                } else {
                    const d = new Date(now.getTime() - (n - 1 - i) * 18 * 24 * 60 * 60 * 1000);
                    sTimeLabel = d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
                }
                
                aPoints.push({
                    time: sTimeLabel,
                    value: parseFloat(value.toFixed(2)),
                    changePct: ((value - totalCost) / totalCost) * 100
                });
            }

            // Calculate analytics from generated points
            const maxPoint = aPoints.reduce((max, p) => p.changePct > max.changePct ? p : max, aPoints[0]);
            const minPoint = aPoints.reduce((min, p) => p.changePct < min.changePct ? p : min, aPoints[0]);
            
            // Find closest to break-even (closest to 0%)
            const bePoint = aPoints.reduce((closest, p) => Math.abs(p.changePct) < Math.abs(closest.changePct) ? p : closest, aPoints[0]);
            
            const flucPct = maxPoint.changePct - minPoint.changePct;
            const overallChange = aPoints[aPoints.length - 1].changePct;

            oVM.setProperty("/analytics/bestPerfValue", (maxPoint.changePct >= 0 ? "+" : "") + maxPoint.changePct.toFixed(2) + "%");
            oVM.setProperty("/analytics/bestPerfTime", maxPoint.time + (isDemo ? " (Demo)" : ""));
            
            oVM.setProperty("/analytics/worstPerfValue", (minPoint.changePct >= 0 ? "+" : "") + minPoint.changePct.toFixed(2) + "%");
            oVM.setProperty("/analytics/worstPerfTime", minPoint.time + (isDemo ? " (Demo)" : ""));
            
            oVM.setProperty("/analytics/breakEvenTime", bePoint.time);
            oVM.setProperty("/analytics/breakEvenSub", isDemo ? "Demo Baseline" : "Stable Crossing");
            
            oVM.setProperty("/analytics/totalFluctuation", flucPct.toFixed(2) + "%");
            oVM.setProperty("/analytics/totalFluctuationSub", flucPct > 5 ? "High Volatility" : "Stable Range");

            let sTrend = "Neutral";
            let sTrendClass = "pfAnalyticsVal pfValWhite";
            let sTrendIcon = "sap-icon://line-chart";
            let sTrendIconClass = "pfAnalyticsTrendIcon pfValWhiteIcon";
            let sTrendSub = "Sideways Move";

            if (overallChange > 1.0) {
                sTrend = "Bullish";
                sTrendClass = "pfAnalyticsVal pfValGreen";
                sTrendIcon = "sap-icon://trend-up";
                sTrendIconClass = "pfAnalyticsTrendIcon pfValGreenIcon";
                sTrendSub = "Up " + overallChange.toFixed(2) + "% overall";
            } else if (overallChange < -1.0) {
                sTrend = "Bearish";
                sTrendClass = "pfAnalyticsVal pfValRed";
                sTrendIcon = "sap-icon://trend-down";
                sTrendIconClass = "pfAnalyticsTrendIcon pfValRedIcon";
                sTrendSub = "Down " + Math.abs(overallChange).toFixed(2) + "% overall";
            } else {
                sTrendSub = "Shift: " + (overallChange >= 0 ? "+" : "") + overallChange.toFixed(2) + "%";
            }

            oVM.setProperty("/analytics/marketTrend", sTrend);
            oVM.setProperty("/analytics/marketTrendClass", sTrendClass);
            oVM.setProperty("/analytics/marketTrendIcon", sTrendIcon);
            oVM.setProperty("/analytics/marketTrendIconClass", sTrendIconClass);
            oVM.setProperty("/analytics/marketTrendSub", sTrendSub);

            // RENDER CUSTOM SVG GRAPH
            const left = 60;
            const right = 120;
            const top = 35;
            const bottom = 40;
            const width = 1000;
            const height = 320;
            const graphWidth = width - left - right;
            const graphHeight = height - top - bottom;
            const Y_base = top + graphHeight / 2;

            // Calculate max deviation from baseline
            let maxDev = 0.05; // 5% minimum Y scale deviation
            aPoints.forEach(function (pt) {
                const dev = Math.abs(pt.value - totalCost) / totalCost;
                if (dev > maxDev) { maxDev = dev; }
            });
            // Round maxDev up to neat interval (e.g. 5%, 10%, 15%, etc.)
            maxDev = Math.ceil(maxDev * 20) / 20;

            function xScale(index) {
                return left + (index / (n - 1)) * graphWidth;
            }
            function yScale(val) {
                return Y_base - ((val - totalCost) / (totalCost * maxDev)) * (graphHeight / 2);
            }

            // Create coordinate points JSON to pass to JS event listener
            const aPointsWithCoords = aPoints.map(function (pt, idx) {
                const x = xScale(idx);
                const y = yScale(pt.value);
                return {
                    time: pt.time,
                    value: pt.value,
                    changePct: pt.changePct,
                    x: x,
                    y: y
                };
            });

            // Path generation
            let pathD = "";
            let areaD = "";
            aPointsWithCoords.forEach(function (pt, idx) {
                if (idx === 0) {
                    pathD = "M " + pt.x + " " + pt.y;
                    areaD = "M " + pt.x + " " + Y_base + " L " + pt.x + " " + pt.y;
                } else {
                    pathD += " L " + pt.x + " " + pt.y;
                    areaD += " L " + pt.x + " " + pt.y;
                }
            });
            areaD += " L " + xScale(n - 1) + " " + Y_base + " Z";

            // Grid lines and labels HTML
            let gridHtml = "";
            const gridValues = [1, 0.5, 0, -0.5, -1];
            gridValues.forEach(function (multiplier) {
                const val = totalCost * (1 + maxDev * multiplier);
                const y = yScale(val);
                const labelPct = (maxDev * multiplier * 100).toFixed(1);
                const labelText = (multiplier > 0 ? "+" : "") + labelPct + "%";
                gridHtml += `
                    <line x1="${left}" y1="${y}" x2="${width - right}" y2="${y}" stroke="rgba(255,255,255,0.06)" stroke-dasharray="2,2" />
                    <text x="${left - 10}" y="${y + 4}" fill="#64748b" font-size="10" font-family="Inter, sans-serif" text-anchor="end">${labelText}</text>
                `;
            });

            // X-axis time labels HTML (draw approx 5 labels)
            let xLabelsHtml = "";
            const labelStep = Math.max(1, Math.floor(n / 5));
            for (let i = 0; i < n; i++) {
                if (i % labelStep === 0 || i === n - 1) {
                    const x = xScale(i);
                    const pt = aPointsWithCoords[i];
                    xLabelsHtml += `
                        <line x1="${x}" y1="${height - bottom}" x2="${x}" y2="${height - bottom + 5}" stroke="rgba(255,255,255,0.1)" />
                        <text x="${x}" y="${height - bottom + 20}" fill="#64748b" font-size="10" font-family="Inter, sans-serif" text-anchor="middle">${pt.time}</text>
                    `;
                }
            }

            const lastPt = aPointsWithCoords[n - 1];
            const liveColor = lastPt.value >= totalCost ? "#10b981" : "#ef4444";

            // SVG Content
            const sHtmlContent = `
                <div class="tv-chart-container" style="position: relative; width: 100%; height: 320px; overflow: visible;">
                    <svg id="tvPerfSvg" viewBox="0 0 1000 320" width="100%" height="320" style="overflow: visible; background: #090f1d; border-radius: 16px; display: block;"
                         onmousemove="window.tvPerfHover(event, this)"
                         onmouseleave="window.tvPerfLeave(event, this)">
                        <defs>
                            <linearGradient id="profitGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stop-color="#10b981" stop-opacity="0.25"/>
                                <stop offset="100%" stop-color="#10b981" stop-opacity="0.0"/>
                            </linearGradient>
                            <linearGradient id="lossGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stop-color="#ef4444" stop-opacity="0.0"/>
                                <stop offset="100%" stop-color="#ef4444" stop-opacity="0.25"/>
                            </linearGradient>
                            <filter id="glowProfit" x="-10%" y="-10%" width="120%" height="120%">
                                <feGaussianBlur stdDeviation="3" result="blur" />
                                <feComposite in="SourceGraphic" in2="blur" operator="over" />
                            </filter>
                            <filter id="glowLoss" x="-10%" y="-10%" width="120%" height="120%">
                                <feGaussianBlur stdDeviation="3" result="blur" />
                                <feComposite in="SourceGraphic" in2="blur" operator="over" />
                            </filter>
                            <clipPath id="clip-above">
                                <rect x="${left}" y="0" width="${graphWidth}" height="${Y_base}" />
                            </clipPath>
                            <clipPath id="clip-below">
                                <rect x="${left}" y="${Y_base}" width="${graphWidth}" height="${height - Y_base}" />
                            </clipPath>
                        </defs>
                        
                        <!-- Grid Lines -->
                        ${gridHtml}
                        
                        <!-- X Axis line -->
                        <line x1="${left}" y1="${height - bottom}" x2="${width - right}" y2="${height - bottom}" stroke="rgba(255,255,255,0.08)" />
                        ${xLabelsHtml}
                        
                        <!-- Dotted Baseline (Invested Amount) -->
                        <line x1="${left}" y1="${Y_base}" x2="${width - right}" y2="${Y_base}" stroke="#ffffff" stroke-dasharray="3,3" stroke-width="1.2" opacity="0.6" />
                        <text x="${width - right + 10}" y="${Y_base - 6}" fill="#94a3b8" font-size="10" font-family="Inter, sans-serif" text-anchor="start" font-weight="700">Invested Baseline</text>
                        <text x="${width - right + 10}" y="${Y_base + 8}" fill="#ffffff" font-size="11" font-family="Inter, sans-serif" text-anchor="start" font-weight="700">₹${totalCost.toLocaleString("en-IN")}</text>
                        
                        <!-- Profit Zone (Green Above Baseline) -->
                        <g clip-path="url(#clip-above)">
                            <path d="${areaD}" fill="url(#profitGrad)" />
                            <path d="${pathD}" stroke="#10b981" stroke-width="2.5" fill="none" filter="url(#glowProfit)" />
                        </g>
                        
                        <!-- Loss Zone (Red Below Baseline) -->
                        <g clip-path="url(#clip-below)">
                            <path d="${areaD}" fill="url(#lossGrad)" />
                            <path d="${pathD}" stroke="#ef4444" stroke-width="2.5" fill="none" filter="url(#glowLoss)" />
                        </g>
                        
                        <!-- Vertical Tracker Line -->
                        <line id="tvPerfVLine" x1="0" y1="${top}" x2="0" y2="${height - bottom}" stroke="rgba(255, 255, 255, 0.25)" stroke-dasharray="3,3" style="display: none; pointer-events: none;" />
                        
                        <!-- Hover Pointer Circle -->
                        <circle id="tvPerfDot" r="6" stroke="#ffffff" stroke-width="2.5" style="display: none; pointer-events: none; filter: drop-shadow(0 0 4px rgba(255,255,255,0.6));" />
                        
                        <!-- Active Glowing Terminal Dot -->
                        <circle cx="${lastPt.x}" cy="${lastPt.y}" r="5" fill="${liveColor}" />
                        <circle cx="${lastPt.x}" cy="${lastPt.y}" r="11" fill="none" stroke="${liveColor}" stroke-width="1.5" opacity="0.6">
                            <animate attributeName="r" values="5;14;5" dur="2.4s" repeatCount="indefinite" />
                            <animate attributeName="opacity" values="0.8;0;0.8" dur="2.4s" repeatCount="indefinite" />
                        </circle>
                    </svg>
                    
                    <!-- Floating Custom HTML/CSS Tooltip -->
                    <div id="tvPerfTooltip" style="
                        display: none; 
                        position: absolute; 
                        background: rgba(9, 15, 29, 0.92); 
                        border: 1px solid rgba(255, 255, 255, 0.12); 
                        border-radius: 12px; 
                        padding: 10px 14px; 
                        font-family: 'Inter', sans-serif; 
                        pointer-events: none; 
                        box-shadow: 0 10px 25px rgba(0,0,0,0.55), 0 0 12px rgba(56, 189, 248, 0.15); 
                        z-index: 1000;
                        min-width: 170px;
                        backdrop-filter: blur(8px);
                    ">
                        <div style="font-size: 10px; color: #64748b; font-weight: 700; text-transform: uppercase;" class="tt-time">09:45 AM</div>
                        <div style="font-size: 15px; font-weight: 800; margin-top: 2px;" class="tt-val">+2.45%</div>
                        <div style="height: 1px; background: rgba(255,255,255,0.06); margin: 6px 0;"></div>
                        <div style="display: flex; justify-content: SpaceBetween; font-size: 10px; color: #94a3b8; margin: 2px 0;">
                            <span>Portfolio:</span>
                            <span style="font-weight: 700; color: #fff;" class="tt-port">₹35,00,000.00</span>
                        </div>
                        <div style="display: flex; justify-content: SpaceBetween; font-size: 10px; color: #94a3b8; margin: 2px 0;">
                            <span>Invested:</span>
                            <span style="font-weight: 700; color: #fff;" class="tt-inv">₹34,73,800.00</span>
                        </div>
                        <div style="display: flex; justify-content: SpaceBetween; font-size: 10px; color: #94a3b8; margin: 2px 0;">
                            <span>Net P&L:</span>
                            <span style="font-weight: 700;" class="tt-pl">+₹26,200.00</span>
                        </div>
                    </div>
                    
                </div>
            `;
            
            // Assign baseline and coordinates to global variables for mouse handlers
            window.tvPerfSvgPoints = aPointsWithCoords;
            window.tvPerfSvgBaseline = totalCost;

            const oChartHTML = this.byId("pfPerfChartHTML");
            if (oChartHTML) {
                oChartHTML.setContent(sHtmlContent);
            }
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
            /* Performance chart is now a custom SVG — no VizFrame styling needed */

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
                    press: async () => {
                        const iAmt = parseFloat(oAmtInput.getValue());
                        if (!iAmt || iAmt <= 0) return MessageBox.error("Enter a valid amount.");
                        try {
                            const oVM       = this.getView().getModel("pfVM");
                            const sCustomer = (oVM.getProperty("/customerName") || "Demo Customer").trim();
                            const oModel    = this.getOwnerComponent().getModel();
                            const oList     = oModel.bindList("/Transactions");
                            
                            oList.create({
                                customerName: sCustomer,
                                transactionType: "ADD_FUNDS",
                                quantity: 1,
                                unitPrice: iAmt,
                                totalPrice: iAmt,
                                status: "COMPLETED"
                            });
                            
                            MessageToast.show("₹" + iAmt.toLocaleString("en-IN") + " added to your wallet!");
                            oDialog.close();
                            // Delay slightly to let db transaction propagate then refresh UI
                            setTimeout(async () => {
                                await this._loadAll();
                            }, 500);
                        } catch (e) {
                            console.error(e);
                            MessageBox.error("Failed to add funds. Please try again.");
                        }
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