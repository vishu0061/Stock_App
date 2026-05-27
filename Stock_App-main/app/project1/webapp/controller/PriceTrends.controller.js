sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/core/routing/History",
    "sap/m/MessageToast",
    "sap/ui/core/format/DateFormat"
], function (Controller, JSONModel, History, MessageToast, DateFormat) {
    "use strict";

    return Controller.extend("sap.stocktrading.app.controller.PriceTrends", {

        onInit: function () {
            this.getOwnerComponent().getRouter().getRoute("priceTrends").attachPatternMatched(this._onRouteMatched, this);

            // JSONModel for stat cards + chart data
            this.getView().setModel(new JSONModel({
                currentPrice: "Loading...",
                volume: 0,
                trend: "NEUTRAL",
                history: []
            }), "trends");

            this._intervalId   = null;
            this._selectedStockId = null;
            this._stocks       = [];   // plain JS array, no UI5 model needed
        },

        /* ── Route matched ── */
        _onRouteMatched: function () {
            this._stopPolling();
            this._loadStockList();
        },

        /* ── Load all products via plain AJAX and populate the native <select> ── */
        _loadStockList: function () {
            var self = this;

            $.ajax({
                url: "/api/Products?$select=ID,productName,currency&$orderby=productName",
                method: "GET",
                cache: false,
                success: function (data) {
                    self._stocks = (data && data.value) ? data.value : [];
                    self._populateNativeSelect();
                },
                error: function (err) {
                    console.error("Failed to load product list:", err);
                }
            });
        },

        /* ── Fill the native HTML <select> with product options ── */
        _populateNativeSelect: function () {
            var self   = this;
            var $el    = jQuery("#nativeStockSelect");

            if (!$el.length) {
                // DOM not ready yet – wait for afterRendering callback
                return;
            }

            // Build option HTML
            var html = "";
            this._stocks.forEach(function (p) {
                html += "<option value='" + p.ID + "'>" +
                        p.productName + " (" + p.currency + ")" +
                        "</option>";
            });
            $el.html(html);

            // Attach change listener (only once – unbind first to be safe)
            $el.off("change").on("change", function () {
                var sKey = $el.val();
                if (sKey) {
                    self._selectedStockId = sKey;
                    self._stopPolling();
                    self._loadStockData();
                    self._startPolling();
                }
            });

            // Auto-select first stock
            if (this._stocks.length > 0) {
                $el.val(this._stocks[0].ID);
                this._selectedStockId = this._stocks[0].ID;
                this._loadStockData();
                this._startPolling();
            }
        },

        /* ── afterRendering hook on the core:HTML control – once the native select is in the DOM, populate it ── */
        onStockSelectorRendered: function () {
            if (this._stocks.length > 0) {
                this._populateNativeSelect();
            }
        },

        /* ── Navigation ── */
        onNavBack: function () {
            this._stopPolling();
            var oHistory = History.getInstance();
            var sPreviousHash = oHistory.getPreviousHash();
            if (sPreviousHash !== undefined) {
                window.history.go(-1);
            } else {
                this.getOwnerComponent().getRouter().navTo("admin", {}, true);
            }
        },

        onRefreshChart: function () {
            this._loadStockData();
            MessageToast.show("Chart refreshed manually");
        },

        /* ── Polling helpers ── */
        _startPolling: function () {
            this._stopPolling();
            this._intervalId = setInterval(this._loadStockData.bind(this), 5000);
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

        /* ── Main data fetch – price, volume, chart history ── */
        _loadStockData: function () {
            if (!this._selectedStockId) { return; }

            var self           = this;
            var oModel         = this.getView().getModel("trends");
            var timeFormat     = DateFormat.getTimeInstance({ pattern: "HH:mm:ss" });
            var shortFmt       = DateFormat.getDateTimeInstance({ pattern: "MMM dd HH:mm" });
            var todayStr       = new Date().toDateString();
            var sId            = this._selectedStockId;

            // ── 1. Current price & trend ──
            $.ajax({
                url: "/api/Products(" + sId + ")",
                method: "GET",
                cache: false,
                success: function (data) {
                    var d = data;
                    if (data && data.value) {
                        d = Array.isArray(data.value) ? data.value[0] : data.value;
                    }
                    if (d) {
                        oModel.setProperty("/currentPrice", (d.currency || "") + " " + Number(d.price || 0).toFixed(2));
                        oModel.setProperty("/trend", d.trend || "NEUTRAL");
                    }
                },
                error: function (err) { console.error("Product fetch error:", err); }
            });

            // ── 2. Transaction volume ──
            $.ajax({
                url: "/api/Transactions?$filter=product_ID eq " + sId,
                method: "GET",
                cache: false,
                success: function (data) {
                    var txs = (data && data.value) ? data.value : [];
                    var vol = 0;
                    txs.forEach(function (t) { vol += Number(t.quantity || 0); });
                    oModel.setProperty("/volume", vol);
                }
            });

            // ── 3. Historical + live ticks → chart ──
            var sHist = "/api/HistoricalPrices?$filter=product_ID eq " + sId + "&$orderby=createdAt asc&$top=30";
            var sLive = "/api/PriceHistory?$filter=product_ID eq "     + sId + "&$orderby=timestamp asc&$top=50";

            $.when(
                $.ajax({ url: sHist, method: "GET", cache: false }),
                $.ajax({ url: sLive, method: "GET", cache: false })
            ).done(function (resHist, resLive) {
                var combined = [];

                ((resHist[0] && resHist[0].value) || []).forEach(function (h) {
                    var d = new Date(h.createdAt);
                    if (!isNaN(d) && Number(h.price) > 0) {
                        combined.push({ rawDate: d, price: Number(h.price) });
                    }
                });

                ((resLive[0] && resLive[0].value) || []).forEach(function (h) {
                    var d = new Date(h.timestamp);
                    if (!isNaN(d) && Number(h.close) > 0) {
                        combined.push({ rawDate: d, price: Number(h.close) });
                    }
                });

                combined.sort(function (a, b) { return a.rawDate - b.rawDate; });

                var final = combined.map(function (item) {
                    return {
                        timeLabel: item.rawDate.toDateString() === todayStr
                            ? timeFormat.format(item.rawDate)
                            : shortFmt.format(item.rawDate),
                        price: item.price
                    };
                });

                if (final.length > 50) { final = final.slice(final.length - 50); }

                oModel.setProperty("/history", final);

                // Re-apply viz properties
                setTimeout(function () {
                    var oViz = self.byId("priceTrendChart");
                    if (oViz) {
                        oViz.setVizProperties({
                            title:    { text: "Live Price Chart" },
                            legend:   { visible: false },
                            plotArea: {
                                dataLabel:   { visible: false },
                                colorPalette: ["#059669"],
                                line: { marker: { visible: true, size: 4 } }
                            },
                            categoryAxis: { title: { visible: true, text: "Time" } },
                            valueAxis:    { title: { visible: true, text: "Price" } }
                        });
                    }
                }, 300);

            }).fail(function (err) {
                console.error("Chart data fetch error:", err);
            });
        }

    });
});