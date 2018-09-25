import ethers, {utils, Interface} from 'ethers';
import Identity from 'universal-login-contracts/build/Identity';
import {MANAGEMENT_KEY, ECDSA_TYPE, ACTION_KEY} from 'universal-login-contracts';
import {addressToBytes32, waitForContractDeploy, messageSignature} from './utils/utils';
import {resolveName, codeEqual} from './utils/ethereum';
import RelayerObserver from './observers/RelayerObserver';
import BlockchainObserver from './observers/BlockchainObserver';
import {headers, fetch} from './utils/http';

class EthereumIdentitySDK {
  constructor(relayerUrl, provider) {
    this.provider = provider;
    this.relayerUrl = relayerUrl;
    this.relayerObserver = new RelayerObserver(relayerUrl);
    this.blockchainObserver = new BlockchainObserver(provider);
  }

  async create(ensName) {
    const privateKey = this.generatePrivateKey();
    const wallet = new ethers.Wallet(privateKey, this.provider);
    const managementKey = wallet.address;
    const url = `${this.relayerUrl}/identity`;
    const method = 'POST';
    const body = JSON.stringify({managementKey, ensName});
    const response = await fetch(url, {headers, method, body});
    const responseJson = await response.json();
    if (response.status === 201) {
      const contract = await waitForContractDeploy(this.provider, Identity, responseJson.transaction.hash);
      return [privateKey, contract.address];
    }
    throw new Error(`${response.status}`);
  }

  async addKey(to, publicKey, privateKey) {
    const key = addressToBytes32(publicKey);
    const {data} = new Interface(Identity.interface).functions.addKey(key, MANAGEMENT_KEY, ECDSA_TYPE);
    const message = {
      to,
      value: 0,
      data
    };
    return await this.execute(to, message, privateKey);
  }

  async removeKey(to, address, privateKey) {
    const key = addressToBytes32(address);
    const {data} = new Interface(Identity.interface).functions.removeKey(key, MANAGEMENT_KEY);
    const message = {
      to,
      value: 0,
      data
    };
    return await this.execute(to, message, privateKey);
  }

  generatePrivateKey() {
    return ethers.Wallet.createRandom().privateKey;
  }

  async getRelayerConfig() {
    const url = `${this.relayerUrl}/config`;
    const method = 'GET';
    const response = await fetch(url, {headers, method});
    const responseJson = await response.json();
    if (response.status === 200) {
      return responseJson;
    }
    throw new Error(`${response.status}`);
  }

  async execute(contractAddress, message, privateKey) {
    const url = `${this.relayerUrl}/identity/execution`;
    const method = 'POST';
    const wallet = new ethers.Wallet(privateKey, this.provider);
    const signature = messageSignature(wallet, message.to, message.value, message.data);
    const body = JSON.stringify({...message, contractAddress, signature});
    const response = await fetch(url, {headers, method, body});
    const responseJson = await response.json();
    if (response.status === 201) {
      const receipt = await this.provider.getTransactionReceipt(responseJson.transaction.hash);
      return this.getExecutionNonce(receipt.logs);
    }
    throw new Error(`${response.status}`);
  }

  getExecutionNonce(emittedEvents) {
    const [eventTopic] = new Interface(Identity.interface).events.ExecutionRequested.topics;
    for (const event of emittedEvents) {
      if (event.topics[0] === eventTopic) {
        return utils.bigNumberify(event.topics[1]);
      }
    }
    throw 'Event ExecutionRequested not emitted';
  }

  async identityExist(identity) {
    const identityAddress = await this.resolveName(identity);
    if (identityAddress && codeEqual(Identity.runtimeBytecode, await this.provider.getCode(identityAddress))) {
      return identityAddress;
    }
    return false;
  }

  async resolveName(identity) {
    this.config = this.config || (await this.getRelayerConfig()).config;
    const {ensAddress} = this.config;
    return resolveName(this.provider, ensAddress, identity);
  }

  async connect(identityAddress, label = '') {
    const privateKey = this.generatePrivateKey();
    const wallet = new ethers.Wallet(privateKey, this.provider);
    const key = wallet.address;
    const url = `${this.relayerUrl}/authorisation`;
    const method = 'POST';
    const body = JSON.stringify({identityAddress, key, label});
    const response = await fetch(url, {headers, method, body});
    if (response.status === 201) {
      return privateKey;
    }
    throw new Error(`${response.status}`);
  }

  async denyRequest(identityAddress, publicKey) {
    const url = `${this.relayerUrl}/authorisation/${identityAddress}`;
    const method = 'POST';
    const body = JSON.stringify({identityAddress, key: publicKey});
    const response = await fetch(url, {headers, method, body});
    if (response.status === 201) {
      return publicKey;
    }
    throw new Error(`${response.status}`);
  }

  async fetchPendingAuthorisations(identityAddress) {
    return this.relayerObserver.fetchPendingAuthorisations(identityAddress);
  }

  subscribe(eventType, identityAddress, callback) {
    if (['AuthorisationsChanged'].includes(eventType)) {
      return this.relayerObserver.subscribe(eventType, identityAddress, callback);
    } else if (['KeyAdded', 'KeyRemoved'].includes(eventType)) {
      return this.blockchainObserver.subscribe(eventType, identityAddress, callback);
    }
    throw `Unknown event type: ${eventType}`;
  }

  async start() {
    await this.relayerObserver.start();
    await this.blockchainObserver.start();
  }

  stop() {
    this.relayerObserver.stop();
    this.blockchainObserver.stop();
  }

  async finalizeAndStop() {
    await this.relayerObserver.finalizeAndStop();
    await this.blockchainObserver.finalizeAndStop();
  }
}

export default EthereumIdentitySDK;
export {MANAGEMENT_KEY, ACTION_KEY, ECDSA_TYPE};
