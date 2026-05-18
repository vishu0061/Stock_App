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
            
            this.getView().setModel(new JSONModel({
                currentPrice: "0.00",
                volume: "0",
                trend: "NEUTRAL",
                history: []
            }), "trends");

            this._intervalId = null;
            this._selectedStockId = null;
        },

        _onRouteMatched: function () {
            var oModel = this.getOwnerComponent().getModel();
            var oListBinding = oModel.bindList("/Products");
            
            oListBinding.requestContexts(0, 1).then(function (aContexts) {
                if (aContexts.length > 0) {
                    var sFirstKey = aContexts[0].getProperty("ID");
                    var oSelect = this.byId("stockSelector");
                    
                    // Allow UI to render the items first
                    setTimeout(function() {
                        oSelect.setSelectedKey(sFirstKey);
                        this._selectedStockId = sFirstKey;
                        this._loadStockData();
                        this._startPolling();
                    }.bind(this), 100);
                }
            }.bind(this));
        },

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

        onStockSelect: function (oEvent) {
            this._selectedStockId = oEvent.getParameter("selectedItem").getKey();
            this._loadStockData();
        },

        onRefreshChart: function () {
            this._loadStockData();
            MessageToast.show("Chart refreshed manually");
        },

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

        _loadStockData: function () {
            if (!this._selectedStockId) return;
            
            var oModel = this.getView().getModel("trends");
            var timeFormat = DateFormat.getTimeInstance({ pattern: "HH:mm:ss" });

            // Fetch product details
            $.ajax({
                url: "/api/Products(" + this._selectedStockId + ")",
                method: "GET",
                success: function (data) {
                    if (data) {
                        var d = data;
                        if (data.value && Array.isArray(data.value) && data.value.length > 0) d = data.value[0];
                        else if (data.value) d = data.value;

                        oModel.setProperty("/currentPrice", (d.currency || "$") + " " + Number(d.price || 0).toFixed(2));
                        oModel.setProperty("/trend", d.trend || "NEUTRAL");
                    }
                },
                error: function(err) {
                    console.error("Failed to fetch product:", err);
                }
            });

            // Fetch actual historical trading volume from transactions
            $.ajax({
                url: "/api/Transactions?$filter=product_ID eq " + this._selectedStockId,
                method: "GET",
                success: function (data) {
                    var txs = data.value || data || [];
                    var totalVol = 0;
                    txs.forEach(function(t) {
                        totalVol += (t.quantity || 0);
                    });
                    oModel.setProperty("/volume", totalVol);
                }
            });

            // Fetch Legacy Historical Mock Data first
            var sHistoricalUrl = "/api/HistoricalPrices?$filter=product_ID eq " + this._selectedStockId + "&$orderby=createdAt desc&$top=30";
            var sLiveUrl = "/api/PriceHistory?$filter=product_ID eq " + this._selectedStockId + "&$orderby=timestamp desc&$top=50";

            $.when(
                $.ajax({ url: sHistoricalUrl, method: "GET" }),
                $.ajax({ url: sLiveUrl, method: "GET" })
            ).done(function (resHistorical, resLive) {
                var dataHist = resHistorical[0];
                var dataLive = resLive[0];
                var combinedHistory = [];

                if (dataHist && dataHist.value) {
                    var histMapped = dataHist.value.reverse().map(function(h) {
                        return {
                            timeLabel: timeFormat.format(new Date(h.createdAt)),
                            price: Number(h.price || 0)
                        };
                    });
                    combinedHistory = combinedHistory.concat(histMapped);
                }

                if (dataLive && dataLive.value) {
                    var liveMapped = dataLive.value.reverse().map(function(h) {
                        return {
                            timeLabel: timeFormat.format(new Date(h.timestamp)),
                            price: Number(h.close || 0)
                        };
                    });
                    combinedHistory = combinedHistory.concat(liveMapped);
                }

                // Keep only the latest 60 points to keep chart clean
                if (combinedHistory.length > 60) {
                    combinedHistory = combinedHistory.slice(combinedHistory.length - 60);
                }

                oModel.setProperty("/history", combinedHistory);
            }).fail(function(err) {
                console.error("Failed to fetch price history:", err);
            });
        }

    });
});
