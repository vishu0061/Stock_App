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

            // Stop polling when navigating away from analytics page
            this.getOwnerComponent().getRouter().attachRouteMatched(function (oEvent) {
                var sRouteName = oEvent.getParameter("name");
                if (sRouteName !== "analytics") {
                    this._stopPolling();
                }
            }, this);

            this._intervalId = null;
        },

        _onRouteMatched: function () {
            this._loadAnalyticsData();
            this._startPolling();
        },

        _startPolling: function () {
            this._stopPolling();
            this._intervalId = setInterval(function () {
                this._loadAnalyticsData();
            }.bind(this), 6000); // 6 seconds live interval
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

        _loadAnalyticsData: function () {
            var self = this;
            var oModel = this.getView().getModel("analytics");

            // Fetch basic analytics
            $.ajax({
                url: "/api/getAnalytics()",
                method: "GET",
                cache: false,
                success: function (data) {
                    if (data) {
                        var d = data.value || data;
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
                cache: false,
                success: function (data) {
                    var txs = data.value || data || [];
                    var buys = 0;
                    var sells = 0;
                    txs.forEach(function (t) {
                        if (t.transactionType === "BUY") buys += 1;
                        else if (t.transactionType === "SELL") sells += 1;
                    });
                    
                    oModel.setProperty("/buySellDistribution", [
                        { type: "Buy Orders", count: buys },
                        { type: "Sell Orders", count: sells }
                    ]);

                    // Configure buySellChart viz properties
                    var oBuySellChart = self.byId("buySellChart");
                    if (oBuySellChart) {
                        oBuySellChart.setVizProperties({
                            title: { visible: false },
                            plotArea: {
                                dataLabel: { visible: true, type: "value" },
                                colorPalette: ["#059669", "#dc2626"]
                            }
                        });
                    }
                }
            });

            // Fetch products for Top Traded Stocks
            $.ajax({
                url: "/api/Products",
                method: "GET",
                cache: false,
                success: function (productData) {
                    var products = productData.value || productData || [];
                    var productMap = {};
                    products.forEach(function(p) {
                        productMap[p.ID] = p.productName;
                    });

                    $.ajax({
                        url: "/api/Transactions",
                        method: "GET",
                        cache: false,
                        success: function (txData) {
                            var txs = txData.value || txData || [];
                            var stockCounts = {};
                            
                            txs.forEach(function(t) {
                                if (!stockCounts[t.product_ID]) {
                                    stockCounts[t.product_ID] = 0;
                                }
                                stockCounts[t.product_ID] += 1; // Count each trade as 1 transaction
                            });
                            
                            var stocks = [];
                            for (var id in stockCounts) {
                                stocks.push({
                                    stockName: productMap[id] || "Unknown",
                                    tradeCount: stockCounts[id]
                                });
                            }
                            
                            // Sort descending
                            stocks.sort(function(a, b) {
                                return b.tradeCount - a.tradeCount;
                            });

                            // Take top 5
                            oModel.setProperty("/topStocks", stocks.slice(0, 5));

                            // Configure topStocksChart viz properties
                            var oTopStocksChart = self.byId("topStocksChart");
                            if (oTopStocksChart) {
                                oTopStocksChart.setVizProperties({
                                    title: { visible: false },
                                    plotArea: {
                                        dataLabel: { visible: true, showZero: true },
                                        colorPalette: ["#7c3aed"]
                                    },
                                    valueAxis: {
                                        title: { visible: true, text: "Trade Volume" }
                                    },
                                    categoryAxis: {
                                        title: { visible: true, text: "Stock" }
                                    }
                                });
                            }
                        }
                    });
                }
            });
        }

    });
});
