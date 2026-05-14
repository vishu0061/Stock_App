sap.ui.define([
  "sap/ui/core/UIComponent",
  "sap/ui/Device",
  "sap/ui/model/json/JSONModel"
], (UIComponent, Device, JSONModel) => {
  "use strict";

  return UIComponent.extend("sap.stocktrading.app.Component", {
    metadata: { manifest: "json" },

    init () {
      UIComponent.prototype.init.apply(this, arguments);

      // Device model
      const oDevModel = new JSONModel(Device);
      oDevModel.setDefaultBindingMode("OneWay");
      this.setModel(oDevModel, "device");

      // Global app state
      this.setModel(new JSONModel({
        currentUser : "Customer1",
        busyBuy     : false
      }), "appState");

      this.getRouter().initialize();
    }
  });
});