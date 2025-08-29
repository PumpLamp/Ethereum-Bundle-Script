const ethers = require('ethers');
const dotenv = require('dotenv');
const DEGToken = require('../abi/DegentralizedToken.json')
const { UNISWAP_V2_ROUTER, WETH } = require("./constants");
const UniswapV2Router02ABI = require('@uniswap/v2-periphery/build/UniswapV2Router02.json');
const routerABI = UniswapV2Router02ABI.abi;
const factoryABI = require("../abi/IUniswapV2Factory.json");
const pairABI = require('../abi/IUniswapV2Pair.json');
const { generateNewWallet, readJSONFromFile, writeJSONToFile } = require('./utils');
const fs = require('fs');

const tokenABI = DEGToken.abi;

dotenv.config();

// checking 
async function checkDevWallets() {
    try {
        function Wallet(wallet) {
            this.Address = wallet.address;
            this.privateKey = wallet.privateKey;
            this.EthAmount = wallet.balance;
            this.TokenAmount = wallet.token;
        }

        const provider = new ethers.providers.JsonRpcBatchProvider(process.env.CHAIN_RPC_HTTP_URL);

        let walletList = [];

        const devWallets = process.env.ZOMBIES.split(',');

        // console.log("\nLoaded Dev Wallets: ", devWallets);

        for (let devWallet of devWallets) {

            const wallet = new ethers.Wallet(devWallet, provider);
            const tokenContract = new ethers.Contract(process.env.TOKEN_ADDRESS, tokenABI, wallet);
            const tokenAmount = await tokenContract.balanceOf(wallet.address);
            const ethAmount = await wallet.getBalance();

            walletList.push(new Wallet({
                address: wallet.address,
                privateKey: wallet.privateKey,
                balance: ethAmount.toString() / 1e18,
                token: ethers.utils.formatUnits(tokenAmount)
            }));
        }
        console.log("\n\n📄 Dev wallets Info")
        console.table(walletList);
    } catch (error) {
        console.log("Error: ", error)
    }
}

async function checkPool() {
    try {
        const provider = new ethers.providers.JsonRpcBatchProvider(process.env.CHAIN_RPC_HTTP_URL);
        const router = new ethers.Contract(UNISWAP_V2_ROUTER[process.env.CHAINNAME], routerABI, provider)
        const factoryAddr = await router.factory();
        const factoryContract = new ethers.Contract(factoryAddr, factoryABI, provider)
        const pairAddr = await factoryContract.getPair(WETH[process.env.CHAINNAME], process.env.TOKEN_ADDRESS)
        const pairContract = new ethers.Contract(pairAddr, pairABI, provider);
        const [R0, R1] = await pairContract.getReserves();

        function PoolInfo(data) {
            this.Addres = data.address
            this.Token = data.token;
            this.ETH = data.ethAmount;
        }
        let poolList = []
        poolList.push(new PoolInfo({
            address: pairAddr,
            token: R0.toString() / 1e18,
            ethAmount: R1.toString() / 1e18
        }))
        console.log("📄 POOL INFO")
        console.table(poolList)
    } catch (error) {
        console.log("Error: ", error)
    }
}

async function checkTradingWallets(params) {
    try {
        function Wallet(wallet) {
            this.Address = wallet.address;
            this.privateKey = wallet.privateKey;
            this.EthAmount = wallet.balance;
            this.TokenAmount = wallet.token;
        }

        const provider = new ethers.providers.JsonRpcBatchProvider(process.env.CHAIN_RPC_HTTP_URL);

        let walletList = [];

        let walletsInfo;
        try {
            if (!fs.existsSync("wallets.json")) {
                console.log('Not exist wallet.json file')
                fs.writeFileSync("wallets.json", "", "utf-8");
            }
            walletsInfo = readJSONFromFile("wallets.json");
        } catch (error) {
            console.log("wallets.json file doesn't exist.", error);
        }
        if (!walletsInfo || (walletsInfo && walletsInfo.length == 0)) {
            walletsInfo = [];
            for (let i = 0; i < parseInt(process.env.WALLET_DIST_COUNT); i++) {
                let { privKey, address } = generateNewWallet();
                walletsInfo.push({
                    privateKey: privKey,
                    address: address,
                })
            }
            writeJSONToFile("wallets.json", walletsInfo);
        }

        const tradingWallets = require("../wallets.json");
        console.log("✅ Wallets loaded from wallets.json file successfully.");
        console.table(tradingWallets);
        console.log("\n\n🔄 Loading balances of the wallets.\n   Please wait for a minute until getting balances...\n\n");
        for (let tradingWallet of tradingWallets) {
            const wallet = new ethers.Wallet(tradingWallet.privateKey, provider);
            const tokenContract = new ethers.Contract(process.env.TOKEN_ADDRESS, tokenABI, wallet);
            const tokenAmount = await tokenContract.balanceOf(wallet.address);
            const ethAmount = await wallet.getBalance();

            walletList.push(new Wallet({
                address: wallet.address,
                privateKey: wallet.privateKey,
                balance: ethAmount.toString() / 1e18,
                token: ethers.utils.formatUnits(tokenAmount)
            }));
        }
        console.log("\n\n📄 Trading wallets info")
        console.table(walletList);
    } catch (error) {
        console.log("Error: ", error)
    }
}
async function checkAll() {
    await checkPool();
    await checkDevWallets();
    await checkTradingWallets();
}

module.exports = {
    checkDevWallets,
    checkTradingWallets,
    checkPool,
    checkAll,
}