import fetch from 'node-fetch';
import chai from 'chai';
import EthereumIdentitySDK from '../lib/sdk';
import {RelayerUnderTest} from 'ethereum-identity-sdk-relayer';
import {createMockProvider, getWallets, solidity} from 'ethereum-waffle';
import {utils} from 'ethers';

chai.use(solidity);

const {expect} = chai;

const RELAYER_URL = 'http://127.0.0.1:3311';

global.fetch = fetch;

describe('SDK - Identity', async () => {
  let provider;
  let relayer;
  let sdk;
  let otherWallet;
  let sponsor;

  before(async () => {
    provider = createMockProvider();
    [otherWallet, sponsor] = await getWallets(provider);
    relayer = await RelayerUnderTest.createPreconfigured(provider);
    await relayer.start();
    sdk = new EthereumIdentitySDK(RELAYER_URL, provider);
  });

  describe('Create', async () => {
    let privateKey;
    let identityAddress;

    before(async () => {
      [privateKey, identityAddress] = await sdk.create('alex.mylogin.eth');
      sponsor.send(identityAddress, 10000);
    });

    it('should return proper private key and address', async () => {
      expect(privateKey).to.be.properPrivateKey;
      expect(identityAddress).to.be.properAddress;
    });

    it('should register ENS name', async () => {
      expect(await relayer.provider.resolveName('alex.mylogin.eth')).to.eq(identityAddress);
    });

    xit('should throw InvalidENS exception if invalid ENS name', async () => {

    });

    it('should return ens config', async () => {
      const expectedEnsAddress = relayer.config.chainSpec.ensAddress;
      const response = await sdk.getRelayerConfig();
      expect(response.config.ensAddress).to.eq(expectedEnsAddress);
    });

    describe('Execute signed message', async () => {
      let expectedBalance;
      let nonce;
      let message;

      before(async () => {
        message = {
          to: otherWallet.address,
          value: 10,
          data: utils.hexlify(0)
        };
        expectedBalance = (await otherWallet.getBalance()).add(10);
        nonce = await sdk.execute(identityAddress, message, privateKey);
      });

      it('Should execute signed message', async () => {
        expect(await otherWallet.getBalance()).to.eq(expectedBalance);
      });

      it('Should return 0 as first nonce', async () => {
        expect(nonce).to.eq(0);
      });

      it('Should return 1 as second nonce', async () => {
        expect(await sdk.execute(identityAddress, message, privateKey)).to.eq(1);
      });
    });
  });

  after(async () => {
    await relayer.stop();
  });
});
