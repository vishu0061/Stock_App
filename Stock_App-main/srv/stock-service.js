const cds = require("@sap/cds");

module.exports = cds.service.impl(async function () {

    const {
        Products,
        Transactions,
        Portfolio,
        HistoricalPrices,
        PriceHistory,
        Notifications
    } = this.entities;

    let globalMarketTrend = 0;

    // ================= REAL-TIME PRICE ENGINE =================
    setInterval(async () => {
        const tx = cds.tx();
        try {
            const entities = cds.entities("sap.stocktrading");
            if (!entities || !entities.Products) {
                await tx.rollback();
                return; // Wait until loaded
            }
            const { Products, PriceHistory } = entities;

            globalMarketTrend = Math.sin(Date.now() / 100000); // Simple oscillating trend
            const aProducts = await tx.run(SELECT.from(Products).where({ status: { "in": ["ACTIVE", "LOW"] } }));
            const now = new Date();

            for (const p of aProducts) {
                const buyQty = p.buyPressure || 0;
                const sellQty = p.sellPressure || 0;
                const stockQuantity = p.stockQuantity || 0;
                const demandScore = p.demandScore || 1.0;
                const volatility = p.volatilityPct || 2.5;
                const previousPrice = Number(p.price || 0);

                let daysWithoutBuy = 0;
                if (p.lastBoughtAt) {
                    daysWithoutBuy = (now - new Date(p.lastBoughtAt)) / (1000 * 60 * 60 * 24);
                }

                // STEP 1 - MARKET FORCE
                const marketForce = (buyQty - sellQty) / (buyQty + sellQty + stockQuantity + 1);

                // STEP 2 - DEMAND SCORE UPDATE
                const newDemandScore = (demandScore * 0.9) + (marketForce * 0.1);

                // STEP 3 - INACTIVITY PENALTY (capped at 5%)
                const inactivityPenalty = Math.min(daysWithoutBuy * 0.002, 0.05);

                // STEP 4 - RANDOM NOISE
                const randomNoise = (Math.random() - 0.5) * 0.01;

                // STEP 5 - FINAL PRICE CHANGE PERCENT
                let priceChangePercent = (
                    (marketForce * 0.45) +
                    (newDemandScore * 0.25) +
                    (globalMarketTrend * 0.20) +
                    (randomNoise * 0.10) -
                    inactivityPenalty
                ) * (volatility * 0.01);

                // STEP 6 - CLAMP PRICE MOVEMENT
                priceChangePercent = Math.max(-0.10, Math.min(priceChangePercent, 0.10));

                // STEP 7 & 8 - CURRENT PRICE
                let newPrice = previousPrice * (1 + priceChangePercent);
                newPrice = Number(Math.max(newPrice, 1).toFixed(2));

                // Decay the pressures so they don't compound forever
                const newBuyQty = Math.floor(buyQty * 0.8);
                const newSellQty = Math.floor(sellQty * 0.8);
                const newTrend = priceChangePercent > 0 ? "BULL" : (priceChangePercent < 0 ? "BEAR" : "NEUTRAL");

                await tx.run(UPDATE(Products).set({
                    previousPrice: previousPrice,
                    price: newPrice,
                    buyPressure: newBuyQty,
                    sellPressure: newSellQty,
                    trend: newTrend,
                    demandScore: newDemandScore,
                    lastMarketTickAt: now.toISOString()
                }).where({ ID: p.ID }));

                const high = Math.max(previousPrice, newPrice);
                const low = Math.min(previousPrice, newPrice);

                await tx.run(INSERT.into(PriceHistory).entries({
                    ID: cds.utils.uuid(),
                    product_ID: p.ID,
                    open: previousPrice,
                    high: Number((high + (high * 0.001)).toFixed(2)),
                    low: Number((low - (low * 0.001)).toFixed(2)),
                    close: newPrice,
                    volume: buyQty + sellQty,
                    timestamp: now.toISOString()
                }));

                // --- Real-time Price Spike Notifications Generator ---
                const absolutePct = Math.abs(priceChangePercent * 100);
                if (absolutePct >= 3.0) {
                    const direction = priceChangePercent > 0 ? "Spiked" : "Dropped";
                    const title = priceChangePercent > 0 ? "Price Spike Alert" : "Price Drop Alert";
                    const message = `${p.productName} has ${direction} by ${absolutePct.toFixed(2)}% to ₹${newPrice.toFixed(2)}`;

                    // Alert "Demo Customer"
                    const [existingSpike] = await tx.run(
                        SELECT.from(Notifications).where({
                            type: "spike",
                            title: title,
                            customerName: "Demo Customer",
                            isRead: false
                        })
                    );
                    if (!existingSpike) {
                        await tx.run(INSERT.into(Notifications).entries({
                            ID: cds.utils.uuid(),
                            type: "spike",
                            title: title,
                            message: message,
                            isRead: false,
                            customerName: "Demo Customer"
                        }));
                    }
                }
            }
            await tx.commit();
        } catch (e) {
            await tx.rollback();
            console.error("Market Engine Error:", e);
        }
    }, 5000);

    // ================= DATA CLEANUP ENGINE =================
    // Runs every 1 hour to prevent the PriceHistory database from growing infinitely
    setInterval(async () => {
        const tx = cds.tx();
        try {
            const entities = cds.entities("sap.stocktrading");
            if (!entities || !entities.PriceHistory) {
                await tx.rollback();
                return;
            }
            const { PriceHistory } = entities;
            const sevenDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

            await tx.run(DELETE.from(PriceHistory).where('timestamp <', sevenDaysAgo));

            if (entities.Notifications) {
                const { Notifications } = entities;
                // Delete read notifications older than 1 day
                const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
                await tx.run(DELETE.from(Notifications).where('isRead =', true).and('createdAt <', oneDayAgo));
            }

            await tx.commit();
        } catch (e) {
            await tx.rollback();
            console.error("Cleanup Engine Error:", e);
        }
    }, 60 * 60 * 1000); // 1 Hour

    // ================= GET ANALYTICS =================

    this.on("getAnalytics", async () => {

        const aProducts = await SELECT.from(Products);
        const aTransactions = await SELECT.from(Transactions);

        let iMarketValue = 0;
        let iAvailableStocks = 0;

        aProducts.forEach((oProduct) => {
            iMarketValue += Number(oProduct.price || 0) * Number(oProduct.stockQuantity || 0);
            iAvailableStocks += Number(oProduct.stockQuantity || 0);
        });

        let revenue = 0;
        let totalTrades = 0;
        let marketVolume = 0;
        const activeUsers = new Set();

        const productCurrencyMap = {};
        aProducts.forEach(p => {
            productCurrencyMap[p.ID] = p.currency;
        });

        aTransactions.forEach(t => {
            if (t.transactionType === "BUY" || t.transactionType === "SELL") {
                totalTrades++;
            }
            marketVolume += Number(t.quantity || 0);
            activeUsers.add(t.customerName);
            if (t.transactionType === "BUY") {
                let amt = Number(t.totalPrice || 0) * 0.01;
                const sCurrency = productCurrencyMap[t.product_ID];
                if (sCurrency === "USD") {
                    amt = amt * 90;
                }
                revenue += amt;
            }
        });

        return {
            totalProducts: aProducts.length,
            availableStocks: iAvailableStocks,
            transactions: aTransactions.length,
            marketValue: iMarketValue.toFixed(2),
            revenueGrowth: 12.5,
            liveVolatility: 2.4,
            totalTrades: totalTrades,
            marketVolume: marketVolume,
            activeUsers: activeUsers.size,
            revenue: revenue.toFixed(2)
        };

    });

    // ================= CREATE PRODUCT =================

    this.on("createProduct", async (req) => {

        try {
            const { productName, stockQuantity, price, currency, category_ID, volatilityPct } = req.data;

            const newProduct = {
                ID: cds.utils.uuid(),
                productName,
                stockQuantity,
                price,
                currency,
                category_ID,
                status: "ACTIVE",
                trend: "NEUTRAL",
                volatilityPct: volatilityPct || 2.5
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
            const { id, productName, stockQuantity, price, currency, category_ID, status, volatilityPct } = req.data;

            const oUpdate = { productName, stockQuantity, price, currency, category_ID };
            if (status) { oUpdate.status = status; }
            if (volatilityPct) { oUpdate.volatilityPct = volatilityPct; }

            await UPDATE(Products).set(oUpdate).where({ ID: id });

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

            const unitPrice = Number(oProduct.price);
            const totalPrice = unitPrice * quantity;
            const newQty = oProduct.stockQuantity - quantity;

            // Update stock quantity and buy pressure
            const newBuyPressure = (oProduct.buyPressure || 0) + quantity;
            const newStatus = newQty === 0 ? "OUT" : (newQty < 20 ? "LOW" : "ACTIVE");

            await UPDATE(Products).set({
                stockQuantity: newQty,
                buyPressure: newBuyPressure,
                status: newStatus,
                lastBoughtAt: new Date().toISOString()
            }).where({ ID: productId });

            // Record transaction
            await INSERT.into(Transactions).entries({
                ID: cds.utils.uuid(),
                product_ID: productId,
                customerName,
                transactionType: "BUY",
                quantity,
                unitPrice,
                totalPrice,
                status: "COMPLETED"
            });

            // Record Buy Executed Notification
            await INSERT.into(Notifications).entries({
                ID: cds.utils.uuid(),
                type: "buy",
                title: "Buy Executed",
                message: `${quantity} × ${oProduct.productName} @ ${oProduct.currency} ${unitPrice.toFixed(2)}`,
                isRead: false,
                customerName: customerName
            });

            // Record Low Stock alert if applicable
            if (newQty < 20) {
                const [existingAlert] = await SELECT.from(Notifications).where({
                    type: "alert",
                    customerName: customerName,
                    title: "Low Stock Alert",
                    message: `${oProduct.productName} — only ${newQty} units remaining`,
                    isRead: false
                });
                if (!existingAlert) {
                    await INSERT.into(Notifications).entries({
                        ID: cds.utils.uuid(),
                        type: "alert",
                        title: "Low Stock Alert",
                        message: `${oProduct.productName} — only ${newQty} units remaining`,
                        isRead: false,
                        customerName: customerName
                    });
                }
            }

            // Upsert portfolio
            const [existing] = await SELECT.from(Portfolio).where({ customerName, product_ID: productId });
            if (existing) {
                const newTotalQty = existing.quantity + quantity;
                const newAvgBuyPrice = ((existing.avgBuyPrice * existing.quantity) + (unitPrice * quantity)) / newTotalQty;
                await UPDATE(Portfolio).set({
                    quantity: newTotalQty,
                    avgBuyPrice: Number(newAvgBuyPrice.toFixed(2)),
                    lastTradeAt: new Date().toISOString()
                }).where({ ID: existing.ID });
            } else {
                await INSERT.into(Portfolio).entries({
                    ID: cds.utils.uuid(),
                    customerName,
                    product_ID: productId,
                    quantity,
                    avgBuyPrice: unitPrice,
                    currency: oProduct.currency,
                    lastTradeAt: new Date().toISOString()
                });
            }

            return {
                success: true,
                message: `Bought ${quantity} x ${oProduct.productName} for ${oProduct.currency} ${totalPrice.toFixed(2)}`,
                totalPrice,
                remainingQty: newQty,
                newPrice: unitPrice // Price hasn't ticked yet
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

            const unitPrice = Number(oProduct.price);
            const totalPrice = unitPrice * quantity;
            const newStockQty = oProduct.stockQuantity + quantity;

            const newSellPressure = (oProduct.sellPressure || 0) + quantity;

            await UPDATE(Products).set({
                stockQuantity: newStockQty,
                sellPressure: newSellPressure,
                status: "ACTIVE"
            }).where({ ID: productId });

            // Record transaction
            await INSERT.into(Transactions).entries({
                ID: cds.utils.uuid(),
                product_ID: productId,
                customerName,
                transactionType: "SELL",
                quantity,
                unitPrice,
                totalPrice,
                status: "COMPLETED"
            });

            // Record Sell Executed Notification
            await INSERT.into(Notifications).entries({
                ID: cds.utils.uuid(),
                type: "sell",
                title: "Sell Executed",
                message: `${quantity} × ${oProduct.productName} @ ${oProduct.currency} ${unitPrice.toFixed(2)}`,
                isRead: false,
                customerName: customerName
            });

            // Update portfolio
            const newHoldingQty = holding.quantity - quantity;
            if (newHoldingQty <= 0) {
                await DELETE.from(Portfolio).where({ ID: holding.ID });
            } else {
                await UPDATE(Portfolio).set({
                    quantity: newHoldingQty,
                    lastTradeAt: new Date().toISOString()
                }).where({ ID: holding.ID });
            }

            return {
                success: true,
                message: `Sold ${quantity} x ${oProduct.productName} for ${oProduct.currency} ${totalPrice.toFixed(2)}`,
                totalPrice,
                remainingQty: newStockQty,
                newPrice: unitPrice
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

            // Group holdings by product_ID to consolidate duplicates and compute weighted average buy price
            const consolidated = {};
            for (const h of aHoldings) {
                const pid = h.product_ID;
                if (!consolidated[pid]) {
                    consolidated[pid] = {
                        product_ID: pid,
                        quantity: 0,
                        avgBuyPrice: 0,
                        currency: h.currency,
                        lastTradeAt: h.lastTradeAt
                    };
                }
                const c = consolidated[pid];
                const hQty = Number(h.quantity || 0);
                const hAvgBuyPrice = Number(h.avgBuyPrice || 0);
                const newQty = c.quantity + hQty;
                
                if (newQty > 0) {
                    c.avgBuyPrice = ((c.avgBuyPrice * c.quantity) + (hAvgBuyPrice * hQty)) / newQty;
                }
                c.quantity = newQty;
                if (h.lastTradeAt && (!c.lastTradeAt || new Date(h.lastTradeAt) > new Date(c.lastTradeAt))) {
                    c.lastTradeAt = h.lastTradeAt;
                }
            }

            const result = [];
            for (const pid in consolidated) {
                const h = consolidated[pid];
                if (h.quantity <= 0) continue; // Skip empty positions
                
                const [prod] = await SELECT.from(Products).where({ ID: pid });
                if (!prod) continue;

                const currentPrice = Number(prod.price || 0);
                const avgBuy = Number(h.avgBuyPrice || 0);
                const qty = h.quantity;
                const totalValue = currentPrice * qty;
                const profitLoss = (currentPrice - avgBuy) * qty;
                const profitLossPct = avgBuy > 0 ? ((currentPrice - avgBuy) / avgBuy) * 100 : 0;

                result.push({
                    productId:     pid,
                    productName:   prod.productName || "",
                    category:      prod.category_ID || "",
                    quantity:      qty,
                    avgBuyPrice:   Number(avgBuy.toFixed(2)),
                    currentPrice:  currentPrice,
                    previousPrice: Number(prod.previousPrice || currentPrice),
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
                case "1D": dFrom.setDate(dFrom.getDate() - 1); break;
                case "1W": dFrom.setDate(dFrom.getDate() - 7); break;
                case "1M": dFrom.setMonth(dFrom.getMonth() - 1); break;
                case "1Y": dFrom.setFullYear(dFrom.getFullYear() - 1); break;
                default: dFrom.setDate(dFrom.getDate() - 7);
            }

            const aHistory = await SELECT.from(HistoricalPrices)
                .where({ product_ID: productId, createdAt: { '>=': dFrom.toISOString() } })
                .orderBy("createdAt asc");

            return aHistory.map((h) => ({
                createdAt: h.createdAt,
                price: Number(h.price),
                changePct: Number(h.changePct || 0),
                volume: Number(h.volume || 0),
                reason: h.reason || "TICK"
            }));

        } catch (err) {
            console.error("GET PRICE HISTORY ERROR:", err);
            req.error(500, err.message);
        }

    });

    // ================= CLEAR ALL NOTIFICATIONS =================
    this.on("clearAllNotifications", async (req) => {
        const { customerName } = req.data;
        try {
            if (!customerName || customerName === "admin" || customerName === "Demo Admin") {
                await UPDATE(Notifications)
                    .set({ isRead: true })
                    .where({ isRead: false });
            } else {
                await UPDATE(Notifications)
                    .set({ isRead: true })
                    .where({ customerName: customerName, isRead: false });
            }
            return true;
        } catch (err) {
            console.error("Bulk clearing notifications error:", err);
            req.error(500, err.message);
        }
    });

    // ================= SEED DATA TIME-SHIFT BOOTSTRAP =================
    // Dynamically shifts transaction and historical price seed dates on boot so they fall into the
    // current month/year, avoiding flatline gaps on the price charts.
    cds.once("served", async () => {
        try {
            const tx = cds.tx();
            
            // 1. Shift Transactions if they are old
            const aTx = await tx.run(SELECT.from(Transactions));
            if (aTx && aTx.length > 0) {
                let latestTxDate = null;
                aTx.forEach(t => {
                    if (t.createdAt) {
                        const d = new Date(t.createdAt);
                        if (!latestTxDate || d > latestTxDate) { latestTxDate = d; }
                    }
                });
                if (latestTxDate) {
                    const now = new Date();
                    const diffMs = now - latestTxDate;
                    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
                    if (diffDays > 3) {
                        console.log(`[StockApp Bootstrap] Shifting transaction seed dates by ${diffDays} days to match current timeframe...`);
                        for (const t of aTx) {
                            if (t.createdAt) {
                                const oldDate = new Date(t.createdAt);
                                const newDate = new Date(oldDate.getTime() + diffMs);
                                await tx.run(UPDATE(Transactions).set({
                                    createdAt: newDate.toISOString(),
                                    modifiedAt: newDate.toISOString()
                                }).where({ ID: t.ID }));
                            }
                        }
                    }
                }
            }

            // 2. Shift HistoricalPrices if they are old (handles case where Transactions were already shifted)
            const aHP = await tx.run(SELECT.from(HistoricalPrices));
            if (aHP && aHP.length > 0) {
                let latestHPDate = null;
                aHP.forEach(hp => {
                    if (hp.createdAt) {
                        const d = new Date(hp.createdAt);
                        if (!latestHPDate || d > latestHPDate) { latestHPDate = d; }
                    }
                });
                if (latestHPDate) {
                    const now = new Date();
                    const diffMs = now - latestHPDate;
                    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
                    if (diffDays > 3) {
                        console.log(`[StockApp Bootstrap] Shifting historical price seed dates by ${diffDays} days to match current timeframe...`);
                        for (const hp of aHP) {
                            if (hp.createdAt) {
                                const oldDate = new Date(hp.createdAt);
                                const newDate = new Date(oldDate.getTime() + diffMs);
                                await tx.run(UPDATE(HistoricalPrices).set({
                                    createdAt: newDate.toISOString()
                                }).where({ ID: hp.ID }));
                            }
                        }
                    }
                }
            }

            await tx.commit();
            console.log(`[StockApp Bootstrap] Time-shift alignment checked and successfully completed.`);
        } catch (e) {
            console.error("[StockApp Bootstrap] Failed to shift seed dates:", e);
        }
    });

});