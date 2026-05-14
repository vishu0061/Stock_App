using { sap.stocktrading as db } from '../db/schema';

service StockTradingService @(path: '/api') {

  // ================= ENTITIES =================

  entity Products as projection on db.Products;

  entity Categories as projection on db.Categories;

  entity HistoricalPrices as projection on db.HistoricalPrices;

  entity Transactions as projection on db.Transactions;

  entity Portfolio as projection on db.Portfolio;

  // ================= PRODUCT ACTIONS =================

  action createProduct(
    productName   : String,
    stockQuantity : Integer,
    price         : Decimal,
    currency      : String,
    category_ID   : UUID
  ) returns {
    success : Boolean;
    message : String;
  };

  action updateProduct(
    id            : UUID,
    productName   : String,
    stockQuantity : Integer,
    price         : Decimal,
    currency      : String,
    category_ID   : UUID
  ) returns {
    success : Boolean;
    message : String;
  };

  action deleteProduct(
    id : UUID
  ) returns Boolean;

  // ================= CUSTOMER =================

  action buyStock(
    productId    : UUID,
    customerName : String,
    quantity     : Integer
  ) returns {
    success      : Boolean;
    message      : String;
    totalPrice   : Decimal;
    remainingQty : Integer;
    newPrice     : Decimal;
  };

  action sellStock(
    productId    : UUID,
    customerName : String,
    quantity     : Integer
  ) returns {
    success      : Boolean;
    message      : String;
    totalPrice   : Decimal;
    remainingQty : Integer;
    newPrice     : Decimal;
  };

  // ================= PORTFOLIO =================

  function getPortfolio(customerName : String) returns array of {

    productId     : UUID;

    productName   : String;

    quantity      : Integer;

    avgBuyPrice   : Decimal;

    currentPrice  : Decimal;

    currency      : String;

    totalValue    : Decimal;

    profitLoss    : Decimal;

    profitLossPct : Decimal;
  };

  // ================= ANALYTICS =================

  function getAnalytics() returns {

    totalProducts   : Integer;

    availableStocks : Integer;

    transactions    : Integer;

    marketValue     : Decimal;

    revenueGrowth   : Decimal;

    liveVolatility  : Decimal;
  };

  function getPriceHistory(
    productId : UUID,
    range     : String
  ) returns array of {

    createdAt : Timestamp;

    price     : Decimal;

    changePct : Decimal;

    volume    : Integer;

    reason    : String;
  };

  action simulateMarketTick(
    volatilityOverridePct : Decimal
  ) returns {

    updated : Integer;

    message : String;
  };
}

// ================= OPTIONAL SERVICES =================

service ProductService @(path: '/api/ProductService') {

  entity Products as projection on db.Products;

  entity Categories as projection on db.Categories;
}

service TransactionService @(path: '/api/TransactionService') {

  entity Transactions as projection on db.Transactions;
}

service PortfolioService @(path: '/api/PortfolioService') {

  entity Portfolio as projection on db.Portfolio;
}

service MarketService @(path: '/api/MarketService') {

  entity HistoricalPrices as projection on db.HistoricalPrices;
}