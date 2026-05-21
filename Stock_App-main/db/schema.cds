namespace sap.stocktrading;

using { cuid, managed } from '@sap/cds/common';

entity Categories : cuid, managed {
    name        : String(60) @mandatory;
    description : String(255);
    isActive    : Boolean default true;
}

entity Users : cuid, managed {
    displayName : String(120) @mandatory;
    email       : String(255);
    role        : String(20) @mandatory; // ADMIN | CUSTOMER
    isActive    : Boolean default true;
}

entity Products : cuid, managed {
    productName      : String(100)  @mandatory;

    // Association to category
    category         : Association to Categories;

    stockQuantity    : Integer       @mandatory default 0;

    price            : Decimal(15,2) @mandatory;

    previousPrice    : Decimal(15,2);

    currency         : String(3) default 'INR';

    volatilityPct    : Decimal(5,2) default 2.50;

    buyPressure      : Integer default 0;

    sellPressure     : Integer default 0;

    trend            : String(10) default 'NEUTRAL'; // BULL | BEAR | NEUTRAL

    status           : String(12) default 'ACTIVE'; // ACTIVE | LOW | OUT

    lastPriceAt      : Timestamp @cds.on.insert : $now;

    lastMarketTickAt : Timestamp;

    demandScore      : Decimal(5,2) default 1.00;

    lastBoughtAt     : Timestamp;
}

entity PriceHistory : cuid {
    product          : Association to Products @mandatory;
    timestamp        : Timestamp @cds.on.insert : $now;
    open             : Decimal(15,2);
    high             : Decimal(15,2);
    low              : Decimal(15,2);
    close            : Decimal(15,2);
    volume           : Integer default 0;
}

entity HistoricalPrices : cuid {

    product          : Association to Products @mandatory;

    price            : Decimal(15,2) @mandatory;

    prevPrice        : Decimal(15,2);

    changePct        : Decimal(8,3);

    volume           : Integer default 0;

    reason           : String(30); // BUY | SELL | TICK | ADMIN

    buyPressure      : Integer default 0;

    sellPressure     : Integer default 0;

    createdAt        : Timestamp @cds.on.insert : $now;
}

entity Transactions : cuid, managed {

    product          : Association to Products;

    customerName     : String(100) @mandatory;

    transactionType  : String(10) @mandatory; // BUY | SELL | ADD_FUNDS

    quantity         : Integer @mandatory;

    unitPrice        : Decimal(15,2);

    totalPrice       : Decimal(15,2);

    status           : String(20) default 'COMPLETED';

    createdAt        : Timestamp @cds.on.insert : $now;
}

entity Portfolio : cuid, managed {

    customerName     : String(100) @mandatory;

    product          : Association to Products @mandatory;

    quantity         : Integer default 0;

    avgBuyPrice      : Decimal(15,2);

    currency         : String(3);

    lastTradeAt      : Timestamp;
}