sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/ui/core/Item"
], function (Controller, MessageToast, MessageBox, Item) {
    "use strict";

    return Controller.extend("sap.stocktrading.app.controller.CreateStock", {

        onInit: function () {
            this._loadCategories();
        },

        /* ── Navigation ───────────────────────────────────────── */

        onNavBack: function () {
            this.getOwnerComponent().getRouter().navTo("admin");
        },

        /* ── Load categories into the Select ─────────────────── */

        _loadCategories: function () {
            var oSelect = this.byId("csCategory");
            var oModel  = this.getOwnerComponent().getModel();

            oModel.bindList("/Categories").requestContexts().then(function (aCtx) {
                var aCats = aCtx.map(function (c) { return c.getObject(); });
                aCats.forEach(function (cat) {
                    oSelect.addItem(new Item({ key: cat.ID, text: cat.name }));
                });
                if (aCats.length) { oSelect.setSelectedKey(aCats[0].ID); }
            }).catch(function (e) {
                console.error("[CreateStock] Category load error:", e);
            });
        },

        /* ── OData action helper ──────────────────────────────── */

        _callAction: function (sPath, oData) {
            return fetch(sPath, {
                method:      "POST",
                headers:     { "Content-Type": "application/json" },
                credentials: "include",
                body:        JSON.stringify(oData)
            }).then(function (r) { return r.json(); });
        },

        /* ── Reset form ───────────────────────────────────────── */

        _resetForm: function () {
            this.byId("csName").setValue("");
            this.byId("csPrice").setValue("");
            this.byId("csQty").setValue("");
            this.byId("csVol").setValue("2.5");
            this.byId("csCurrency").setSelectedKey("INR");
        },

        /* ── Submit form ──────────────────────────────────────── */

        onSubmitCreate: function () {
            var sName  = this.byId("csName").getValue().trim();
            var sCatId = this.byId("csCategory").getSelectedKey();
            var fPrice = parseFloat(this.byId("csPrice").getValue());
            var sCurr  = this.byId("csCurrency").getSelectedKey() || "INR";
            var iQty   = parseInt(this.byId("csQty").getValue(), 10);
            var fVol   = parseFloat(this.byId("csVol").getValue() || "2.5");

            /* Validation */
            if (!sName)              { MessageToast.show("Product Name is required.");      return; }
            if (!sCatId)             { MessageToast.show("Please select a Category.");       return; }
            if (isNaN(fPrice) || fPrice <= 0) { MessageToast.show("Enter a valid Price.");  return; }
            if (isNaN(iQty)   || iQty  <= 0) { MessageToast.show("Enter a valid Quantity."); return; }

            /* Disable button during submit */
            var oBtn = this.byId("csSubmitBtn");
            oBtn.setEnabled(false);
            oBtn.setText("Creating…");

            var self = this;
            this._callAction("/api/createProduct", {
                productName:   sName,
                stockQuantity: iQty,
                price:         fPrice,
                currency:      sCurr,
                category_ID:   sCatId,
                volatilityPct: isNaN(fVol) ? 2.5 : fVol
            }).then(function (res) {
                // Always reset button
                oBtn.setEnabled(true);
                oBtn.setText("Create Stock");

                if (res.success !== false) {
                    self._resetForm();
                    MessageBox.success(
                        "\"" + sName + "\" has been listed on the platform.",
                        {
                            title: "Stock Created",
                            onClose: function () {
                                self.getOwnerComponent().getRouter().navTo("manageStocks");
                            }
                        }
                    );
                } else {
                    MessageToast.show("!" + (res.message || "Create failed"));
                }
            }).catch(function (e) {
                MessageToast.show("Network error: " + e.message);
                oBtn.setEnabled(true);
                oBtn.setText("Create Stock");
            });
        }

    });
});
