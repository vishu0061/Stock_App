sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/core/routing/History",
    "sap/m/MessageToast"
], function (Controller, JSONModel, History, MessageToast) {
    "use strict";

    return Controller.extend("sap.stocktrading.app.controller.Analytics", {

        onInit: function () {
            this.getOwnerComponent().getRouter().getRoute("analytics").attachPatternMatched(this._onRouteMatched, this);
            this._oModel = this.getOwnerComponent().getModel();
            
            this.getView().setModel(new JSONModel({
                totalTrades: 0,
                activeUsers: 0,
                marketVolume: 0,
                revenue: "0.00",
                buySellDistribution: [],
                topStocks: []
            }), "analytics");
        },

        _onRouteMatched: function () {
            this._loadAnalyticsData();
        },

        onNavBack: function () {
            var oHistory = History.getInstance();
            var sPreviousHash = oHistory.getPreviousHash();
            if (sPreviousHash !== undefined) {
                window.history.go(-1);
            } else {
                this.getOwnerComponent().getRouter().navTo("admin", {}, true);
            }
        },

        _loadAnalyticsData: function () {
            var oModel = this.getView().getModel("analytics");

            // Fetch basic analytics
            $.ajax({
                url: "/api/getAnalytics()",
                method: "GET",
                success: function (data) {
                    if (data && data.value) {
                        var d = data.value;
                        oModel.setProperty("/totalTrades", d.totalTrades);
                        oModel.setProperty("/activeUsers", d.activeUsers);
                        oModel.setProperty("/marketVolume", d.marketVolume);
                        oModel.setProperty("/revenue", "$" + d.revenue);
                    }
                }
            });

            // Fetch transactions for Buy/Sell distribution
            $.ajax({
                url: "/api/Transactions",
                method: "GET",
                success: function (data) {
                    if (data && data.value) {
                        var buys = 0;
                        var sells = 0;
                        data.value.forEach(function (t) {
                            if (t.transactionType === "BUY") buys += t.quantity;
                            else sells += t.quantity;
                        });
                        
                        oModel.setProperty("/buySellDistribution", [
                            { type: "Buy Orders", count: buys },
                            { type: "Sell Orders", count: sells }
                        ]);
                    }
                }
            });

            // Fetch products for Top Traded Stocks
            $.ajax({
                url: "/api/Products",
                method: "GET",
                success: function (data) {
                    if (data && data.value) {
                        var stocks = data.value.map(function(p) {
                            return {
                                stockName: p.productName,
                                tradeCount: (p.buyPressure || 0) + (p.sellPressure || 0)
                            };
                        });
                        
                        // Sort descending
                        stocks.sort(function(a, b) {
                            return b.tradeCount - a.tradeCount;
                        });

                        // Take top 5
                        oModel.setProperty("/topStocks", stocks.slice(0, 5));
                    }
                }
            });
        }

    });
});
