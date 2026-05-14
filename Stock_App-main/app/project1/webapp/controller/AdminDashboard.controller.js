sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "sap/m/MessageBox"
], function (Controller, JSONModel, MessageToast, MessageBox) {
    "use strict";

    return Controller.extend("sap.stocktrading.app.controller.AdminDashboard", {

        /* ═══════════════════════════════════════════════════════════
           LIFECYCLE
        ═══════════════════════════════════════════════════════════ */

        onInit: function () {
            this._loadDashboardData();
            var oRouter = this.getOwnerComponent().getRouter();
            if (oRouter.getRoute("adminDashboard")) {
                oRouter.getRoute("adminDashboard")
                    .attachPatternMatched(this._onRouteMatched, this);
            }
        },

        _onRouteMatched: function () {
            this._loadDashboardData();
        },

        /* ═══════════════════════════════════════════════════════════
           LOAD DASHBOARD DATA
           FIX: removed getPortfolio() — no backend handler exists
                uses bindList directly for Products + Transactions
        ═══════════════════════════════════════════════════════════ */

        _loadDashboardData: async function () {
            try {
                var oModel = this.getOwnerComponent().getModel();

                var aProducts = await oModel
                    .bindList("/Products")
                    .requestContexts(0, 1000);
                this.byId("statTotalStocks").setText(String(aProducts.length));

                var aTx = await oModel
                    .bindList("/Transactions")
                    .requestContexts(0, 5000);

                var iBuyers = 0, iSellers = 0;
                aTx.forEach(function (oCtx) {
                    var t = oCtx.getObject().transactionType;
                    if (t === "BUY")  { iBuyers++; }
                    if (t === "SELL") { iSellers++; }
                });

                this.byId("statTotalBuyers").setText(String(iBuyers));
                this.byId("statTotalSellers").setText(String(iSellers));

                this.getView().setModel(new JSONModel({
                    chartData: [
                        { label: "Buyers",  value: iBuyers  },
                        { label: "Sellers", value: iSellers }
                    ]
                }), "dashboard");

                var oViz = this.byId("buyerSellerChart");
                if (oViz) {
                    oViz.setVizProperties({
                        title:    { text: "Buyers vs Sellers" },
                        legend:   { visible: false },
                        plotArea: { dataLabel: { visible: true }, colorPalette: ["#7c3aed","#059669"] }
                    });
                }

            } catch (oErr) {
                console.error("Dashboard load error:", oErr);
                MessageToast.show("Failed to load dashboard data");
            }
        },

        /* ═══════════════════════════════════════════════════════════
           FORMATTERS
           FIX: expression bindings crash with OData v4 — use formatters
        ═══════════════════════════════════════════════════════════ */

        formatQtyState: function (iQty) {
            if (iQty > 100) { return "Success"; }
            if (iQty > 20)  { return "Warning"; }
            return "Error";
        },

        formatTrendState: function (sTrend) {
            if (sTrend === "BULL") { return "Success"; }
            if (sTrend === "BEAR") { return "Error"; }
            return "Warning";
        },

        formatTrendIcon: function (sTrend) {
            if (sTrend === "BULL") { return "sap-icon://trend-up"; }
            if (sTrend === "BEAR") { return "sap-icon://trend-down"; }
            return "sap-icon://minus";
        },

        formatStatusState: function (sStatus) {
            if (sStatus === "ACTIVE") { return "Success"; }
            if (sStatus === "LOW")    { return "Warning"; }
            return "Error";
        },

        /* ═══════════════════════════════════════════════════════════
           NAV TABS
        ═══════════════════════════════════════════════════════════ */

        onTabDashboard: function () {
            this._setActiveTab("tabDashboard");
            this.getOwnerComponent().getRouter().navTo("adminDashboard");
        },
        onTabStocks: function () {
            this._setActiveTab("tabStocks");
            this.getOwnerComponent().getRouter().navTo("admin");
        },
        onTabAnalytics: function () { this._setActiveTab("tabAnalytics"); MessageToast.show("Analytics coming soon"); },
        onTabTrends:    function () { this._setActiveTab("tabTrends");    MessageToast.show("Trends coming soon"); },
        onTabSettings:  function () { this._setActiveTab("tabSettings");  MessageToast.show("Settings coming soon"); },

        _setActiveTab: function (sActiveId) {
            ["tabDashboard","tabStocks","tabAnalytics","tabTrends","tabSettings"]
                .forEach(function (sId) {
                    var oBtn = this.byId(sId);
                    if (!oBtn) { return; }
                    oBtn[sId === sActiveId ? "addStyleClass" : "removeStyleClass"]("adminNavTabActive");
                }.bind(this));
        },

        /* ═══════════════════════════════════════════════════════════
           LOGOUT
        ═══════════════════════════════════════════════════════════ */

        onLogout: function () {
            MessageBox.confirm("Are you sure you want to logout?", {
                title: "Confirm Logout",
                actions: [MessageBox.Action.OK, MessageBox.Action.CANCEL],
                onClose: function (sAction) {
                    if (sAction === MessageBox.Action.OK) {
                        this.getOwnerComponent().getRouter().navTo("home");
                    }
                }.bind(this)
            });
        },

        /* ═══════════════════════════════════════════════════════════
           QUICK ACTIONS
        ═══════════════════════════════════════════════════════════ */

        onQuickCreateStock:   function () { this.getOwnerComponent().getRouter().navTo("admin"); },
        onQuickManageStocks:  function () { this.getOwnerComponent().getRouter().navTo("admin"); },
        onQuickViewAnalytics: function () { MessageToast.show("Analytics coming soon"); },
        onQuickPriceTrends:   function () { MessageToast.show("Price trends coming soon"); },

        /* ═══════════════════════════════════════════════════════════
           TABLE ROW
        ═══════════════════════════════════════════════════════════ */

        onStockRowPress: function (oEvent) {
            var oCtx = oEvent.getSource().getBindingContext();
            if (!oCtx) { return; }
            var d = {
                name:   oCtx.getProperty("productName"),
                price:  oCtx.getProperty("price"),
                curr:   oCtx.getProperty("currency"),
                status: oCtx.getProperty("status"),
                trend:  oCtx.getProperty("trend"),
                qty:    oCtx.getProperty("stockQuantity")
            };
            MessageBox.information(
                "Product  : " + d.name   + "\n" +
                "Price    : " + d.price  + " " + d.curr + "\n" +
                "Quantity : " + d.qty    + "\n" +
                "Trend    : " + d.trend  + "\n" +
                "Status   : " + d.status,
                { title: d.name }
            );
        },

        onRefresh: function () {
            this._loadDashboardData();
            MessageToast.show("Dashboard refreshed");
        }

    });
});