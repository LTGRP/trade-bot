import createExchange from "../factories/ExchangeFactory";
import OrderService from "./OrderService";
import EVENTS from "../Events";

export default class TradeMonitorService {
  constructor(coinExchangeService, orderService, emitter, coinsToTradeDefault = []) {
    this.coinExchangeService = coinExchangeService;
    this.orderService = orderService;
    this.refreshInterval = 30000;
    this.exchanges = {};
    this.coinsToTrade = [];
    this.coinsToTradeDefault = coinsToTradeDefault;
    this.emitter = emitter;
  }

  emit(event, ...params) {
    this.emitter.emit(event, ...params);
  }

  async start() {
    this.emit(EVENTS.MONITOR_START);
    await this.loadCoins();
    await this.initializeCoins();
    await this.startMonitor();
  }

  async loadCoins() {
    this.emit(EVENTS.MONITOR_LOAD_COINS);
    this.coinsToTrade = await this.coinExchangeService.getCoinsToTrade();
    if (this.coinsToTrade.length === 0) {
      this.coinsToTrade = [...this.coinsToTradeDefault];
    }
  }

  async initializeCoins() {
    this.emit(EVENTS.MONITOR_INIT_COINS);
    for (let i = 0; i < this.coinsToTrade.length; i++) {
      const coin = this.coinsToTrade[i];
      await this.initializeCoinPrice(coin);
    }
  }

  async startMonitor() {
    this.emit(EVENTS.MONITOR_CYCLE, this.coinsToTrade);
    await Promise.all(this.coinsToTrade.map(c => this.checkCoin(c)));
    setTimeout(() => this.startMonitor(), this.refreshInterval);
  }

  async initializeCoinPrice(coin) {
    const priceExchange = await this.getExchangePrice(coin);

    if (!coin.getPriceOrder()) coin.setPriceOrder(priceExchange);
    if (!coin.getPriceStart()) coin.setPriceStart(priceExchange);
    if (!coin.getPriceExchange()) coin.setPriceExchange(priceExchange);
    if (!coin.getAmount()) coin.setAmount(1);
    if (!coin.getPriceChange()) coin.setPriceChange(0);
  }

  async getExchangePrice(coinExchange) {
    const coin = coinExchange.getCoin();
    const exchange = coinExchange.getExchange();
    const baseCoin = coinExchange.getBaseCoin();
    const exchangeAdapter = this.getExchangeAdapter(exchange);

    return await exchangeAdapter.getCoinPrice(coin, baseCoin);
  }

  async checkCoin(coinExchangeModel) {
    this.emit(EVENTS.MONITOR_CHECK_COIN, coinExchangeModel);
    const orderType = this.getOrderType(coinExchangeModel);
    if (orderType) {
      await this.makeOrder(coinExchangeModel, orderType);
    }
    await this.coinExchangeService.saveCoinExchange(coinExchangeModel);
  }

  async getOrderType(coinExchangeModel) {
    const id = coinExchangeModel.getId();
    const percentChange = await this.getPriceChanges(coinExchangeModel);
    coinExchangeModel.setPriceChange(percentChange);

    this.emit(EVENTS.MONITOR_PRICE_CHANGE, coinExchangeModel, percentChange);

    return await this.orderService.getNextOrderType(id, percentChange);
  }

  async makeOrder(coinExchangeModel, orderType) {
    this.emit(EVENTS.MONITOR_MAKE_ORDER, coinExchangeModel, orderType);
    const exchangeOrderId = await this.createExchangeOrder(coinExchangeModel, orderType);
    if (exchangeOrderId) {
      coinExchangeModel.setPriceOrder(coinExchangeModel.getPriceChanges());
      await this.orderService.saveOrder(coinExchangeModel, exchangeOrderId, orderType);
      this.emit(EVENTS.MONITOR_ORDER_DONE, coinExchangeModel, orderType);
    }
  }

  async getPriceChanges(coinExchange) {
    const priceOrder = coinExchange.getPriceOrder();
    const priceExchange = await this.getExchangePrice(coinExchange);
    coinExchange.setPriceExchange(priceExchange);
    const percent = (priceExchange - priceOrder) * 100 / priceExchange;

    return percent.toFixed(2);
  }

  async createExchangeOrder(coinExchangeModel, orderType) {
    const exchange = coinExchangeModel.getExchange();
    const exchangeAdapter = this.getExchangeAdapter(exchange);

    if (OrderService.isValidOrderType(orderType)) {
      let response = {};
      if (orderType === OrderService.ORDER_SELL) {
        response = await exchangeAdapter.sellCoin(coinExchangeModel);
      } else if (orderType === OrderService.ORDER_BUY) {
        response = await exchangeAdapter.buyCoin(coinExchangeModel);
      }

      return response.orderId;
    }

    return null;
  }

  getExchangeAdapter(name) {
    if (!this.exchanges[name]) {
      this.exchanges[name] = createExchange(name);
    }

    return this.exchanges[name];
  }
}
