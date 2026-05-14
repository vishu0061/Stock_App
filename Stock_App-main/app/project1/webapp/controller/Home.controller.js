sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/m/MessageToast"
], function (
    Controller,
    MessageToast
) {

    "use strict";

    return Controller.extend(
        "sap.stocktrading.app.controller.Home",
        {

            onInit: function () {

                // Initialization logic

            },

            onAdminPress: function () {

                MessageToast.show(
                    "Opening Admin Dashboard"
                );

                this.getOwnerComponent()
                    .getRouter()
                    .navTo("admin");

            },

            onCustomerPress: function () {

                MessageToast.show(
                    "Opening Customer Dashboard"
                );

                this.getOwnerComponent()
                    .getRouter()
                    .navTo("customer");

            }

        }
    );

});