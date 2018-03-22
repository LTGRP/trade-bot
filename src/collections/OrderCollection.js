import AbstractCollection from "./AbstractCollection";

const COLLECTION_NAME = 'orders';
export default class OrderCollection extends AbstractCollection {
  async getCollection() {
    const collection = await this.db.collection(COLLECTION_NAME);
    return collection;
  }
}
