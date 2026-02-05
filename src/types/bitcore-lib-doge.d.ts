/**
 * Type declarations for bitcore-lib-doge
 * Covers the subset we use: Transaction, PrivateKey, Script, Networks, Address
 */
declare module "bitcore-lib-doge" {
  export class Transaction {
    inputs: Transaction.Input[];
    outputs: Transaction.Output[];
    hash: string;
    id: string;
    nLockTime: number;

    constructor(serialized?: string | Buffer | object);

    from(utxos: Transaction.UnspentOutput[] | Transaction.UnspentOutput): Transaction;
    to(address: string | Address, amount: number): Transaction;
    change(address: string | Address): Transaction;
    fee(amount: number): Transaction;
    sign(privateKey: PrivateKey | string): Transaction;
    serialize(opts?: { disableAll?: boolean; disableDustOutputs?: boolean; disableSmallFees?: boolean; disableLargeFees?: boolean; disableIsFullySigned?: boolean; disableMoreOutputThanInput?: boolean }): string;
    uncheckedSerialize(): string;
    checkedSerialize(opts?: object): string;
    isFullySigned(): boolean;
    verify(): string | true;
    addOutput(output: Transaction.Output): Transaction;
    addData(data: string | Buffer): Transaction;

    getFee(): number;
    toBuffer(): Buffer;

    static DUST_AMOUNT: number;
    static FEE_PER_KB: number;
  }

  export namespace Transaction {
    class Input {
      prevTxId: Buffer;
      outputIndex: number;
      script: Script;
      output?: Output;
    }

    class Output {
      satoshis: number;
      script: Script;

      constructor(args: { satoshis: number; script: Script | string });
    }

    class UnspentOutput {
      address: string | Address;
      txId: string;
      outputIndex: number;
      script: string | Script;
      satoshis: number;

      constructor(data: {
        address: string;
        txId: string;
        outputIndex: number;
        script: string;
        satoshis: number;
      });
    }
  }

  export class PrivateKey {
    publicKey: PublicKey;
    network: Network;
    bn: any;

    constructor(data?: string | Buffer, network?: Network | string);

    static fromBuffer(buf: Buffer, network?: Network | string): PrivateKey;
    toBuffer(): Buffer;
    toWIF(): string;
    toAddress(): Address;
    toString(): string;
  }

  export class PublicKey {
    constructor(data?: string | Buffer | object);
    toBuffer(): Buffer;
    toAddress(network?: Network | string): Address;
    toString(): string;
  }

  export class Address {
    constructor(data: string | Buffer | object, network?: Network | string, type?: string);
    toString(): string;
    static isValid(data: string, network?: Network | string, type?: string): boolean;
  }

  export class Script {
    constructor(data?: string | Buffer);

    static buildDataOut(data: string | Buffer, encoding?: string): Script;
    static buildPublicKeyHashOut(address: Address | string): Script;

    toBuffer(): Buffer;
    toHex(): string;
    toString(): string;
    isPublicKeyHashOut(): boolean;
    isDataOut(): boolean;
    getData(): Buffer;
  }

  export class Networks {
    static livenet: Network;
    static testnet: Network;
    static mainnet: Network;
    static get(name: string): Network | undefined;
    static add(network: object): Network;
  }

  export interface Network {
    name: string;
    alias?: string;
    pubkeyhash: number;
    privatekey: number;
    scripthash: number;
    xpubkey: number;
    xprivkey: number;
  }
}
