sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator"
], function (Controller, MessageToast, MessageBox, Filter, FilterOperator) {
    "use strict";

    return Controller.extend("sap.stocktrading.app.controller.ManageStocks", {

        onInit: function () {
            this._catPromise = null;
        },

        /* ── Navigation ───────────────────────────────────────── */

        onNavBack: function () {
            this.getOwnerComponent().getRouter().navTo("admin");
        },

        onAddNew: function () {
            this.getOwnerComponent().getRouter().navTo("createStock");
        },

        /* ── Action helper ────────────────────────────────────── */

        _callAction: function (sPath, oData) {
            return fetch(sPath, {
                method:      "POST",
                headers:     { "Content-Type": "application/json" },
                credentials: "include",
                body:        JSON.stringify(oData)
            }).then(function (r) { return r.json(); });
        },

        /* ── Category cache ───────────────────────────────────── */

        _loadCategories: function () {
            var self = this;
            if (this._catPromise) { return this._catPromise; }
            this._catPromise = this.getOwnerComponent().getModel()
                .bindList("/Categories").requestContexts()
                .then(function (aCtx) {
                    self._aCategories = aCtx.map(function (c) { return c.getObject(); });
                    return self._aCategories;
                });
            return this._catPromise;
        },

        /* ── Stats update after table loads ──────────────────── */

        onTableUpdated: function () {
            var oTable  = this.byId("msStocksTable");
            var aItems  = oTable.getItems();
            var iTotal  = aItems.length;
            var iActive = 0, iLow = 0, iOut = 0;

            aItems.forEach(function (item) {
                var s = item.getBindingContext().getObject().status;
                if      (s === "ACTIVE") { iActive++; }
                else if (s === "LOW")    { iLow++;    }
                else if (s === "OUT")    { iOut++;    }
            });

            this.byId("msTotalCount").setText(String(iTotal));
            this.byId("msActiveCount").setText(String(iActive));
            this.byId("msLowCount").setText(String(iLow));
            this.byId("msOutCount").setText(String(iOut));
        },

        /* ── Search / filter ─────────────────────────────────── */

        onSearch: function (oEvent) {
            var sQ      = (oEvent.getParameter("newValue") || oEvent.getParameter("query") || "").trim();
            var oBinding = this.byId("msStocksTable").getBinding("items");
            if (!oBinding) { return; }
            oBinding.filter(sQ ? [new Filter("productName", FilterOperator.Contains, sQ)] : []);
        },

        /* ── Edit stock (opens dialog) ────────────────────────── */

        onEditStock: function (oEvent) {
            oEvent.cancelBubble();
            var oCtx = oEvent.getSource().getBindingContext();
            if (!oCtx) { return; }
            this._openEditDialog(oCtx.getObject());
        },

        _openEditDialog: function (oProduct) {
            var self = this;
            sap.ui.require([
                "sap/m/Dialog", "sap/m/Button", "sap/m/VBox",
                "sap/m/Label",  "sap/m/Input",  "sap/m/Select",
                "sap/m/MessageToast", "sap/ui/core/Item"
            ], function (Dialog, MButton, VBox, MLabel, Input, Select, MToast, Item) {

                self._loadCategories().then(function (aCats) {

                    var oCatItems = aCats.map(function (c) {
                        return new Item({ key: c.ID, text: c.name });
                    });

                    /* ── inputs pre-filled ── */
                    var oPrice  = new Input({ type: "Number", value: String(oProduct.price || ""), width: "100%" });
                    var oQty    = new Input({ type: "Number", value: String(oProduct.stockQuantity || ""), width: "100%" });
                    var oVol    = new Input({ type: "Number", value: String(oProduct.volatilityPct || 2.5), width: "100%" });

                    var oStatus = new Select({ width: "100%", items: [
                        new Item({ key: "ACTIVE", text: "ACTIVE — Available for trading" }),
                        new Item({ key: "LOW",    text: "LOW — Low inventory warning" }),
                        new Item({ key: "OUT",    text: "OUT — Delisted / Unavailable" })
                    ]});
                    oStatus.setSelectedKey(oProduct.status || "ACTIVE");

                    var oCat = new Select({ width: "100%", items: oCatItems });
                    if (oProduct.category_ID) { oCat.setSelectedKey(oProduct.category_ID); }

                    function fRow(sLabel, oCtrl) {
                        var oBox = new VBox({ items: [new MLabel({ text: sLabel }), oCtrl] });
                        oBox.addStyleClass("sapUiSmallMarginBottom");
                        return oBox;
                    }

                    var oContentBox = new VBox({ items: [
                            fRow("Price (" + oProduct.currency + ")", oPrice),
                            fRow("Available Quantity",                  oQty),
                            fRow("Volatility %",                        oVol),
                            fRow("Status",                              oStatus),
                            fRow("Category",                            oCat)
                        ]});
                    oContentBox.addStyleClass("sapUiMediumMarginBeginEnd sapUiSmallMarginTop");

                    var oDialog = new Dialog({
                        title: "✏️  Edit: " + oProduct.productName,
                        contentWidth: "460px",
                        content: [oContentBox],
                        beginButton: new MButton({
                            text: "Save Changes", type: "Emphasized",
                            press: function () {
                                var fP = parseFloat(oPrice.getValue());
                                var iQ = parseInt(oQty.getValue(), 10);
                                var fV = parseFloat(oVol.getValue() || "2.5");

                                if (isNaN(fP) || isNaN(iQ)) {
                                    MToast.show("Price and Quantity are required");
                                    return;
                                }
                                self._callAction("/api/updateProduct", {
                                    id:            oProduct.ID,
                                    productName:   oProduct.productName,
                                    price:         fP,
                                    stockQuantity: iQ,
                                    currency:      oProduct.currency,
                                    category_ID:   oCat.getSelectedKey(),
                                    status:        oStatus.getSelectedKey(),
                                    volatilityPct: fV
                                }).then(function (res) {
                                    if (res.success !== false) {
                                        MToast.show("✅ " + oProduct.productName + " updated");
                                        oDialog.close();
                                        self.byId("msStocksTable").getBinding("items").refresh();
                                    } else {
                                        MToast.show("❌ " + (res.message || "Update failed"));
                                    }
                                }).catch(function (e) { MToast.show("Network error: " + e.message); });
                            }
                        }),
                        endButton: new MButton({
                            text: "Cancel", type: "Transparent",
                            press: function () { oDialog.close(); }
                        }),
                        afterClose: function () { oDialog.destroy(); }
                    });
                    oDialog.open();
                });
            });
        },

        /* ── Delete stock ─────────────────────────────────────── */

        onDeleteStock: function (oEvent) {
            oEvent.cancelBubble();
            var oCtx = oEvent.getSource().getBindingContext();
            if (!oCtx) { return; }
            var oProduct = oCtx.getObject();
            var self     = this;

            MessageBox.confirm(
                "Delete \"" + oProduct.productName + "\"?\nThis action cannot be undone.",
                {
                    title:   "Confirm Delete",
                    icon:    MessageBox.Icon.WARNING,
                    actions: [MessageBox.Action.OK, MessageBox.Action.CANCEL],
                    onClose: function (sAction) {
                        if (sAction !== MessageBox.Action.OK) { return; }
                        self._callAction("/api/deleteProduct", { id: oProduct.ID })
                            .then(function () {
                                MessageToast.show("🗑️  " + oProduct.productName + " deleted");
                                self._catPromise = null;
                                self.byId("msStocksTable").getBinding("items").refresh();
                            })
                            .catch(function (e) {
                                MessageToast.show("Delete failed: " + e.message);
                            });
                    }
                }
            );
        },

        /* ── Formatters (mirrors Admin view formatters) ────────── */

        formatQtyState: function (v) {
            if (v === undefined || v === null) { return "None"; }
            if (v <= 0)  { return "Error"; }
            if (v < 20)  { return "Warning"; }
            return "Success";
        },

        formatChangePercent: function (price, prevPrice) {
            price = Number(price) || 0;
            prevPrice = Number(prevPrice) || price;
            if (prevPrice === 0) return "+0.00%";
            var pct = ((price - prevPrice) / prevPrice) * 100;
            return (pct >= 0 ? "+" : "") + pct.toFixed(2) + "%";
        },

        formatChangeState: function (price, prevPrice) {
            price = Number(price) || 0;
            prevPrice = Number(prevPrice) || price;
            return price >= prevPrice ? "Success" : "Error";
        },

        formatTrendState: function (v) {
            if (v === "BULL") { return "Success"; }
            if (v === "BEAR") { return "Error"; }
            return "Warning";
        },

        formatTrendIcon: function (v) {
            if (v === "BULL") { return "sap-icon://trend-up"; }
            if (v === "BEAR") { return "sap-icon://trend-down"; }
            return "sap-icon://less";
        },

        formatStatusState: function (v) {
            if (v === "ACTIVE") { return "Success"; }
            if (v === "LOW")    { return "Warning"; }
            return "Error";
        }

    });
});
