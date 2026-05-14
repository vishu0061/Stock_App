const cds = require("@sap/cds");

module.exports = cds.service.impl(async function () {

    const {
        Products,
        Transactions
    } = this.entities;

    // ================= GET ANALYTICS =================

    this.on("getAnalytics", async () => {

        const aProducts = await SELECT.from(Products);
        const aTransactions = await SELECT.from(Transactions);

        let iMarketValue = 0;
        let iAvailableStocks = 0;

        aProducts.forEach((oProduct) => {

            iMarketValue +=
                Number(oProduct.price || 0) *
                Number(oProduct.stockQuantity || 0);

            iAvailableStocks +=
                Number(oProduct.stockQuantity || 0);

        });

        return {

            totalProducts:
                aProducts.length,

            availableStocks:
                iAvailableStocks,

            transactions:
                aTransactions.length,

            marketValue:
                iMarketValue.toFixed(2),

            revenueGrowth:
                12.5,

            liveVolatility:
                2.4

        };

    });

    // ================= CREATE PRODUCT =================

    this.on("createProduct", async (req) => {

        try {

            const {
                productName,
                stockQuantity,
                price,
                currency,
                category_ID
            } = req.data;

            const newProduct = {

                ID:
                    cds.utils.uuid(),

                productName,

                stockQuantity,

                price,

                currency,

                category_ID,

                status:
                    "ACTIVE",

                trend:
                    "NEUTRAL"

            };

            await INSERT.into(Products).entries(newProduct);

            return {

                success: true,

                message:
                    "Product created"

            };

        } catch (err) {

            console.error("CREATE PRODUCT ERROR:", err);

            req.error(500, err.message);

        }

    });

    // ================= UPDATE PRODUCT =================

    this.on("updateProduct", async (req) => {

        try {

            const {
                id,
                productName,
                stockQuantity,
                price,
                currency,
                category_ID
            } = req.data;

            await UPDATE(Products)

                .set({

                    productName,

                    stockQuantity,

                    price,

                    currency,

                    category_ID

                })

                .where({
                    ID: id
                });

            return {

                success: true,

                message:
                    "Product updated"

            };

        } catch (err) {

            console.error("UPDATE PRODUCT ERROR:", err);

            req.error(500, err.message);

        }

    });

});