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
            // Check if products are loaded
            var oSelect = this.byId("stockSelector");
            var oBinding = oSelect.getBinding("items");
            if (oBinding) {
                oBinding.attachEventOnce("dataReceived", function() {
                    var sFirstKey = oSelect.getItems()[0] && oSelect.getItems()[0].getKey();
                    if (sFirstKey) {
                        oSelect.setSelectedKey(sFirstKey);
                        this._selectedStockId = sFirstKey;
                        this._loadStockData();
                        this._startPolling();
                    }
                }.bind(this));
            } else {
                // If already bound and has items
                var sFirstKey = oSelect.getItems()[0] && oSelect.getItems()[0].getKey();
                if (sFirstKey) {
                    oSelect.setSelectedKey(sFirstKey);
                    this._selectedStockId = sFirstKey;
                    this._loadStockData();
                    this._startPolling();
                }
            }
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
                        oModel.setProperty("/currentPrice", data.currency + " " + (data.price || 0).toFixed(2));
                        oModel.setProperty("/volume", (data.buyPressure || 0) + (data.sellPressure || 0));
                        oModel.setProperty("/trend", data.trend || "NEUTRAL");
                    }
                }
            });

            // Fetch price history (latest 50 points)
            $.ajax({
                url: "/api/PriceHistory?$filter=product_ID eq " + this._selectedStockId + "&$orderby=timestamp desc&$top=50",
                method: "GET",
                success: function (data) {
                    if (data && data.value) {
                        // Reverse so oldest is first for the chart left-to-right
                        var history = data.value.reverse().map(function(h) {
                            var d = new Date(h.timestamp);
                            return {
                                timeLabel: timeFormat.format(d),
                                price: h.close
                            };
                        });
                        oModel.setProperty("/history", history);
                    }
                }
            });
        }

    });
});
