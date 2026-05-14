const cds = require("@sap/cds");

module.exports = cds.service.impl(async function () {

    const {
        Products,
        Transactions,
        Portfolio,
        HistoricalPrices
    } = this.entities;

    // ================= GET ANALYTICS =================

    this.on("getAnalytics", async () => {

        const aProducts     = await SELECT.from(Products);
        const aTransactions = await SELECT.from(Transactions);

        let iMarketValue    = 0;
        let iAvailableStocks = 0;

        aProducts.forEach((oProduct) => {
            iMarketValue     += Number(oProduct.price || 0) * Number(oProduct.stockQuantity || 0);
            iAvailableStocks += Number(oProduct.stockQuantity || 0);
        });

        return {
            totalProducts:   aProducts.length,
            availableStocks: iAvailableStocks,
            transactions:    aTransactions.length,
            marketValue:     iMarketValue.toFixed(2),
            revenueGrowth:   12.5,
            liveVolatility:  2.4
        };

    });

    // ================= CREATE PRODUCT =================

    this.on("createProduct", async (req) => {

        try {
            const { productName, stockQuantity, price, currency, category_ID } = req.data;

            const newProduct = {
                ID:            cds.utils.uuid(),
                productName,
                stockQuantity,
                price,
                currency,
                category_ID,
                status:        "ACTIVE",
                trend:         "NEUTRAL"
            };

            await INSERT.into(Products).entries(newProduct);

            return { success: true, message: "Product created" };

        } catch (err) {
            console.error("CREATE PRODUCT ERROR:", err);
            req.error(500, err.message);
        }

    });

    // ================= UPDATE PRODUCT =================

    this.on("updateProduct", async (req) => {

        try {
            const { id, productName, stockQuantity, price, currency, category_ID } = req.data;

            await UPDATE(Products)
                .set({ productName, stockQuantity, price, currency, category_ID })
                .where({ ID: id });

            return { success: true, message: "Product updated" };

        } catch (err) {
            console.error("UPDATE PRODUCT ERROR:", err);
            req.error(500, err.message);
        }

    });

    // ================= DELETE PRODUCT =================

    this.on("deleteProduct", async (req) => {

        try {
            const { id } = req.data;
            await DELETE.from(Products).where({ ID: id });
            return true;
        } catch (err) {
            console.error("DELETE PRODUCT ERROR:", err);
            req.error(500, err.message);
        }

    });

    // ================= BUY STOCK =================

    this.on("buyStock", async (req) => {

        const { productId, customerName, quantity } = req.data;

        try {
            const [oProduct] = await SELECT.from(Products).where({ ID: productId });

            if (!oProduct) return req.error(404, "Product not found");
            if (oProduct.stockQuantity < quantity) {
                return { success: false, message: `Only ${oProduct.stockQuantity} units available`, totalPrice: 0, remainingQty: oProduct.stockQuantity, newPrice: oProduct.price };
            }

            const unitPrice  = Number(oProduct.price);
            const totalPrice = unitPrice * quantity;
            const newQty     = oProduct.stockQuantity - quantity;

            // Update stock quantity and buy pressure
            const newBuyPressure  = (oProduct.buyPressure || 0) + quantity;
            const newSellPressure = oProduct.sellPressure || 0;
            const newPrice = _computeNewPrice(unitPrice, oProduct.volatilityPct || 2.5,"BUY", newBuyPressure, newSellPressure, false);
            const newTrend        = newBuyPressure > newSellPressure ? "BULL" : (newBuyPressure < newSellPressure ? "BEAR" : "NEUTRAL");
            const newStatus       = newQty === 0 ? "OUT" : (newQty < 20 ? "LOW" : "ACTIVE");

            await UPDATE(Products).set({
                stockQuantity: newQty,
                buyPressure:   newBuyPressure,
                price:         newPrice,
                previousPrice: unitPrice,
                trend:         newTrend,
                status:        newStatus
            }).where({ ID: productId });

            // Record transaction
            await INSERT.into(Transactions).entries({
                ID:              cds.utils.uuid(),
                product_ID:      productId,
                customerName,
                transactionType: "BUY",
                quantity,
                unitPrice,
                totalPrice,
                status:          "COMPLETED"
            });

            // Record historical price
            await INSERT.into(HistoricalPrices).entries({
                ID:           cds.utils.uuid(),
                product_ID:   productId,
                price:        newPrice,
                prevPrice:    unitPrice,
                changePct:    Number((((newPrice - unitPrice) / unitPrice) * 100).toFixed(3)),
                volume:       quantity,
                reason:       "BUY",
                buyPressure:  newBuyPressure,
                sellPressure: newSellPressure
            });

            // Upsert portfolio
            const [existing] = await SELECT.from(Portfolio).where({ customerName, product_ID: productId });
            if (existing) {
                const newTotalQty    = existing.quantity + quantity;
                const newAvgBuyPrice = ((existing.avgBuyPrice * existing.quantity) + (unitPrice * quantity)) / newTotalQty;
                await UPDATE(Portfolio).set({
                    quantity:     newTotalQty,
                    avgBuyPrice:  Number(newAvgBuyPrice.toFixed(2)),
                    lastTradeAt:  new Date().toISOString()
                }).where({ ID: existing.ID });
            } else {
                await INSERT.into(Portfolio).entries({
                    ID:           cds.utils.uuid(),
                    customerName,
                    product_ID:   productId,
                    quantity,
                    avgBuyPrice:  unitPrice,
                    currency:     oProduct.currency,
                    lastTradeAt:  new Date().toISOString()
                });
            }

            return {
                success:      true,
                message:      `Bought ${quantity} x ${oProduct.productName} for ${oProduct.currency} ${totalPrice.toFixed(2)}`,
                totalPrice,
                remainingQty: newQty,
                newPrice
            };

        } catch (err) {
            console.error("BUY STOCK ERROR:", err);
            req.error(500, err.message);
        }

    });

    // ================= SELL STOCK =================

    this.on("sellStock", async (req) => {

        const { productId, customerName, quantity } = req.data;

        try {
            const [oProduct] = await SELECT.from(Products).where({ ID: productId });
            if (!oProduct) return req.error(404, "Product not found");

            // Check portfolio
            const [holding] = await SELECT.from(Portfolio).where({ customerName, product_ID: productId });
            if (!holding || holding.quantity < quantity) {
                return { success: false, message: `Not enough shares. You own ${holding ? holding.quantity : 0}`, totalPrice: 0, remainingQty: oProduct.stockQuantity, newPrice: oProduct.price };
            }

            const unitPrice    = Number(oProduct.price);
            const totalPrice   = unitPrice * quantity;
            const newStockQty  = oProduct.stockQuantity + quantity;

            const newSellPressure = (oProduct.sellPressure || 0) + quantity;
            const newBuyPressure  = oProduct.buyPressure || 0;
            const newPrice = _computeNewPrice(   unitPrice,  oProduct.volatilityPct || 2.5,"SELL", newBuyPressure, newSellPressure,false);
            const newTrend        = newBuyPressure > newSellPressure ? "BULL" : (newBuyPressure < newSellPressure ? "BEAR" : "NEUTRAL");

            await UPDATE(Products).set({
                stockQuantity: newStockQty,
                sellPressure:  newSellPressure,
                price:         newPrice,
                previousPrice: unitPrice,
                trend:         newTrend,
                status:        "ACTIVE"
            }).where({ ID: productId });

            // Record transaction
            await INSERT.into(Transactions).entries({
                ID:              cds.utils.uuid(),
                product_ID:      productId,
                customerName,
                transactionType: "SELL",
                quantity,
                unitPrice,
                totalPrice,
                status:          "COMPLETED"
            });

            // Record historical price
            await INSERT.into(HistoricalPrices).entries({
                ID:           cds.utils.uuid(),
                product_ID:   productId,
                price:        newPrice,
                prevPrice:    unitPrice,
                changePct:    Number((((newPrice - unitPrice) / unitPrice) * 100).toFixed(3)),
                volume:       quantity,
                reason:       "SELL",
                buyPressure:  newBuyPressure,
                sellPressure: newSellPressure
            });

            // Update portfolio
            const newHoldingQty = holding.quantity - quantity;
            if (newHoldingQty <= 0) {
                await DELETE.from(Portfolio).where({ ID: holding.ID });
            } else {
                await UPDATE(Portfolio).set({
                    quantity:    newHoldingQty,
                    lastTradeAt: new Date().toISOString()
                }).where({ ID: holding.ID });
            }

            return {
                success:      true,
                message:      `Sold ${quantity} x ${oProduct.productName} for ${oProduct.currency} ${totalPrice.toFixed(2)}`,
                totalPrice,
                remainingQty: newStockQty,
                newPrice
            };

        } catch (err) {
            console.error("SELL STOCK ERROR:", err);
            req.error(500, err.message);
        }

    });

    // ================= GET PORTFOLIO =================

    this.on("getPortfolio", async (req) => {

        const { customerName } = req.data;

        try {
            // Load portfolio entries + join product data manually
            const aHoldings = await SELECT.from(Portfolio).where({ customerName });

            const result = [];
            for (const h of aHoldings) {
                const [prod] = await SELECT.from(Products).where({ ID: h.product_ID });
                if (!prod) continue;

                const currentPrice  = Number(prod.price || 0);
                const avgBuy        = Number(h.avgBuyPrice || 0);
                const qty           = Number(h.quantity || 0);
                const totalValue    = currentPrice * qty;
                const profitLoss    = (currentPrice - avgBuy) * qty;
                const profitLossPct = avgBuy > 0 ? ((currentPrice - avgBuy) / avgBuy) * 100 : 0;

                result.push({
                    productId:     h.product_ID,
                    productName:   prod.productName || "",
                    quantity:      qty,
                    avgBuyPrice:   avgBuy,
                    currentPrice:  currentPrice,
                    currency:      h.currency || prod.currency || "INR",
                    totalValue:    Number(totalValue.toFixed(2)),
                    profitLoss:    Number(profitLoss.toFixed(2)),
                    profitLossPct: Number(profitLossPct.toFixed(2))
                });
            }

            return result;

        } catch (err) {
            console.error("GET PORTFOLIO ERROR:", err);
            req.error(500, err.message);
        }

    });

    // ================= GET PRICE HISTORY =================

    this.on("getPriceHistory", async (req) => {

        const { productId, range } = req.data;

        try {
            let dFrom = new Date();
            switch (range) {
                case "1D": dFrom.setDate(dFrom.getDate() - 1);    break;
                case "1W": dFrom.setDate(dFrom.getDate() - 7);    break;
                case "1M": dFrom.setMonth(dFrom.getMonth() - 1);  break;
                case "1Y": dFrom.setFullYear(dFrom.getFullYear() - 1); break;
                default:   dFrom.setDate(dFrom.getDate() - 7);
            }

            const aHistory = await SELECT.from(HistoricalPrices)
                .where({ product_ID: productId })
                .orderBy("createdAt asc");

            return aHistory.map((h) => ({
                createdAt: h.createdAt,
                price:     Number(h.price),
                changePct: Number(h.changePct || 0),
                volume:    Number(h.volume || 0),
                reason:    h.reason || "TICK"
            }));

        } catch (err) {
            console.error("GET PRICE HISTORY ERROR:", err);
            req.error(500, err.message);
        }

    });

    // ================= SIMULATE MARKET TICK =================

    this.on("simulateMarketTick", async (req) => {

        const { volatilityOverridePct } = req.data;

        try {
            const aProducts = await SELECT.from(Products);
            let updated     = 0;

            for (const p of aProducts) {
                const vol      = volatilityOverridePct || p.volatilityPct || 2.5;
                const noActivity =
    (p.buyPressure || 0)
    ===
    (p.sellPressure || 0);

const newPrice = _computeNewPrice( Number(p.price),    vol,  "TICK",  p.buyPressure || 0, p.sellPressure || 0,   noActivity);

                await UPDATE(Products).set({
                    previousPrice:   Number(p.price),
                    price:           newPrice,
                    lastMarketTickAt: new Date().toISOString()
                }).where({ ID: p.ID });

                await INSERT.into(HistoricalPrices).entries({
                    ID:           cds.utils.uuid(),
                    product_ID:   p.ID,
                    price:        newPrice,
                    prevPrice:    Number(p.price),
                    changePct:    Number((((newPrice - p.price) / p.price) * 100).toFixed(3)),
                    volume:       Math.floor(Math.random() * 500) + 50,
                    reason:       "TICK",
                    buyPressure:  p.buyPressure || 0,
                    sellPressure: p.sellPressure || 0
                });

                updated++;
            }

            return { updated, message: `Market tick applied to ${updated} products` };

        } catch (err) {
            console.error("SIMULATE MARKET TICK ERROR:", err);
            req.error(500, err.message);
        }

    });

    // ================= HELPER =================

   function _computeNewPrice(
    currentPrice,
    volatilityPct,
    direction,
    buyPressure = 0,
    sellPressure = 0,
    noActivity = false
) {

    currentPrice  = Number(currentPrice || 0);
    volatilityPct = Number(volatilityPct || 2.5);

    // ============================================
    // RANDOM MARKET VOLATILITY
    // ============================================

    const randomVolatility =
        (Math.random() * volatilityPct) / 10;

    // ============================================
    // BUY / SELL PRESSURE IMPACT
    // ============================================

    let pressureImpact = 0;

    pressureImpact += (buyPressure  * 0.03);

    pressureImpact -= (sellPressure * 0.04);

    // ============================================
    // BASE PRICE MOVEMENT
    // ============================================

    let newPrice = currentPrice;

    if (direction === "BUY") {

        newPrice += pressureImpact;
        newPrice += randomVolatility;

    } else if (direction === "SELL") {

        newPrice += pressureImpact;
        newPrice -= randomVolatility;

    } else {

        // ========================================
        // MARKET TICK / NATURAL MOVEMENT
        // ========================================

        newPrice += pressureImpact;

        const drift =
            (Math.random() - 0.5)
            * volatilityPct;

        newPrice += drift;

    }

    // ============================================
    // NO ACTIVITY DECAY
    // ============================================

    if (noActivity) {

        // -0.3% decay
        newPrice = newPrice * 0.997;

    }

    // ============================================
    // SAFETY FLOOR
    // ============================================

    if (newPrice < 1) {
        newPrice = 1;
    }

    return Number(newPrice.toFixed(2));
}

});