const { chainNames, UNISWAP_V2_ROUTER, WETH } = require('./constants');
const ethers = require('ethers');
const ganache = require('ganache');
const { xBigNumber } = require('./utils');
const ERC20ABI = require("@uniswap/v2-core/build/ERC20.json")
const DEGToken = require("../abi/DegentralizedToken.json")
const BigNumber = require("bignumber.js")
const factoryABI = require("../abi/IUniswapV2Factory.json");
const pairABI = require('../abi/IUniswapV2Pair.json');
const routerABI = require('../abi/IUniSwapV2Router02.json')
// const tokenABI = ERC20ABI.abi;

const tokenABI = DEGToken.abi;
const GAS_LIMIT_INCREASE = 130
const dotenv = require('dotenv');

dotenv.config()

let amountTokenDesired = ethers.utils.parseUnits(process.env.TOKEN_FOR_LIQUIDITY, 18);
let amountETHDesired = ethers.utils.parseUnits(process.env.ETH_FOR_LIQUIDITY, 18);
/**
 * @summary calculate gas fee 
 * 
 * @param {string} chainId 
 * @param {string} token : token address
 * @param {array} wallets : list of wallets to sniper
 * @param {array} approve : let enablet token approve
 * @param {array} methodID : Id of openTrading or enableTrading method, e.g. 0xc9567bf9
 * @param {array} zombies : privkey list of zombie wallets, mother wallets
 * *************************zombies[0] is responsible for addliquidity, zombies[1] is responsible for supplying ETH to wallets
 * @param {int} gasPriceMultiplier : optional, 0 : single player, 1 : multiplier.
 */
async function getETHForBuyBundling(chainId, token, wallets, zombies, gasPriceMultiplier, addliquidity=true, approve=true, methodID=null) {
    const options = {
        logging: { quiet : true },
        chain: { chainId },
        fork: { network: chainNames[chainId] }
    }
    
    // Get Provider of ganache network and accounts, signer, feeData.
    const localProvider = new ethers.providers.Web3Provider(ganache.provider(options));
    const localAccounts = await localProvider.listAccounts();
    const localSigner = localProvider.getSigner(localAccounts[0]);
    const feeData = await localProvider.getFeeData();
    // Get gas fee's data
    const num = gasPriceMultiplier > 0 ? gasPriceMultiplier : 1;
    const den = gasPriceMultiplier > 0 ? 100 : 1;
    const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas;
    const maxFeePerGas = xBigNumber(feeData.maxFeePerGas, num, den);
    
    const chainName = (chainId === 1) ? "eth" : (chainId == 5) ? "goerli" : "sepolia";
    
    const zombieWallet0 = new ethers.Wallet(zombies[0].privateKey, localProvider);
    
    // Get add liquidity transaction info
    let addLiquidityTxInfo={}
    if(addliquidity)
        addLiquidityTxInfo = await _getAddLiquidity(zombieWallet0, maxPriorityFeePerGas, maxFeePerGas, chainId, approve=true);
    
    // Get ETH amount of wallets to buy token
    let buyInfo = await _calcETHOfWalltesForBuy(
        chainName, 
        localProvider, 
        token, 
        wallets.map(item => {
            return {
                address: item.address,
                privateKey: item.privateKey,
                initialTokenAmount: item.initialTokenAmount.toString().replaceAll(" ", "").replaceAll(",", ""),
                initialEthAmount: item.initialEthAmount ? item.initialEthAmount.toString().replaceAll(" ", "").replaceAll(",", "") : '0',
                sim: {
                    tokenAmount: "",
                    ethAmount: "",
                    disperseAmount: "",
                }
            };
        }),        
    )

    // Calculate gas fee to send swap Tx for each wallet
    const routerContract = new ethers.Contract(UNISWAP_V2_ROUTER[chainName], routerABI, localSigner);
    const path = [WETH[chainName], token];
    console.log("Gas Limit calculating per wallets...")
    
    // Set to enable trading before swapping tokens.
    if(methodID){
        try {
            const Opentrading_tx = {
                chainId: chainId,
                type: 2,
                maxFeePerGas: maxFeePerGas,
                maxPriorityFeePerGas: maxPriorityFeePerGas,
                gasLimit: ethers.utils.hexlify(200000),
                to: token, 
                data: methodID,
            }
            await zombieWallet0.sendTransaction(Opentrading_tx);
        } catch (error) {
            console.log("OpenTrading() called Error: ", error)   
        }
    }

    for (let i = 0; i < buyInfo.wallets.length; i ++){
        const walletItem = buyInfo.wallets[i];
        if(!walletItem) continue;
            
        const deadline = Math.floor(Date.now() / 1000) + 3000;
        const args = [walletItem.sim.tokenAmount, path, walletItem.address, deadline, {value: walletItem.sim.ethAmount}]
        const swap_tx = await routerContract.populateTransaction.swapETHForExactTokens(...args);
        const gas_limit = await routerContract.estimateGas.swapETHForExactTokens(...args);
        const tx = {
            chainId: chainId,
            type: 2,
            maxFeePerGas: maxFeePerGas,
            maxPriorityFeePerGas: maxPriorityFeePerGas,
            gasLimit: gas_limit,
            value: walletItem.sim.ethAmount,
            data: swap_tx.data,
            to: swap_tx.to,
        }
        try {
            await localSigner.sendTransaction(tx);
        } catch (error) {
            console.log("Error for buying tokens", i, error.code);
        }
        walletItem.sim.gasLimit = gas_limit.mul(ethers.BigNumber.from(GAS_LIMIT_INCREASE)).div(ethers.BigNumber.from("100")).toString();
    }

    return {
        wallets: buyInfo.wallets,
        addLiquidity: addLiquidityTxInfo
    }
}


async function _getAddLiquidity(zombieWallet, maxPriorityFeePerGas, maxFeePerGas, chainId, approve=true) {
    let addLiquidity = {}
    try {
        console.log("🧨 1) Add Liquidity with zombie wallet #0...")
        let router = new ethers.Contract(UNISWAP_V2_ROUTER[process.env.CHAINNAME], routerABI, zombieWallet);
        let tokenContract = new ethers.Contract(process.env.TOKEN_ADDRESS, tokenABI, zombieWallet);
        // You must send approve tx before sending add liquidity tx
        if(approve){
            const tokenAmount = await tokenContract.totalSupply();
            const _tx = await tokenContract.approve(UNISWAP_V2_ROUTER[process.env.CHAINNAME], ethers.constants.MaxUint256.toString())
            if (_tx) await _tx.wait();
        }        
        
        const args = [
            process.env.TOKEN_ADDRESS,
            amountTokenDesired.toString(),
            0,
            0,
            zombieWallet.address,
            parseInt(Date.now() /1000) + 1200,
            { value: amountETHDesired.toString() }
        ];
        
        // Get add liquidity traction data
        const addLiquidity_tx = await router.populateTransaction.addLiquidityETH(...args);
        const addLiquidityGasLimit = await router.estimateGas.addLiquidityETH(...args);
        
        // Build add liquidity transaction
        const tx = {
            chainId: Number(chainId),
            type: 2,
            maxFeePerGas,
            maxPriorityFeePerGas,
            gasLimit: addLiquidityGasLimit,
            data: addLiquidity_tx.data,
            to: addLiquidity_tx.to,
            value: amountETHDesired.toString()
        };
        // Send add Liquidity transaction.
        try {
            await zombieWallet.sendTransaction(tx);
            // Set transaction info if add liquidity transaction sending is success
            addLiquidity = {
                gasLimit: addLiquidityGasLimit.toString(),
                ethAmount: amountETHDesired.toString(),
            }
        } catch (error) {
            console.log("Error for approve:", error.code);
            // Send 100 ETH to zombie wallet if add liquidity transaction sending is failed
            await localSigner.sendTransaction({
                type: 2,
                to: zombieWallet.address,
                value: ethers.utils.parseEther("100"),
                maxFeePerGas: maxFeePerGas,
                maxPriorityFeePerGas: maxPriorityFeePerGas,
            })
            // Re-send add liquidity transaction
            await zombieWallet.sendTransaction(tx);
        }
    } catch (error) {
        console.log (error)
        return { error: "Unknown"}
    }
    console.log("✔ 1) Add Liquidity simulate seccess...")
    return addLiquidity;
}

async function _calcETHOfWalltesForBuy(chainName, provider, token, wallets) {
    try {
        console.log("🧨 2) Start calculating eth amount ......")
        const routerContract = new ethers.Contract(UNISWAP_V2_ROUTER[chainName], routerABI, provider);
        
        const factoryAddr = await routerContract.factory()
        const factoryContract = new ethers.Contract(factoryAddr, factoryABI, provider);
        
        const pairAddr = await factoryContract.getPair(WETH[chainName], token);
        const pairContract = new ethers.Contract(pairAddr, pairABI, provider);
        
        const tokenContract = new ethers.Contract(process.env.TOKEN_ADDRESS, tokenABI, provider);
        const decimals = await tokenContract.decimals();
        

        // Get Amount for two tokens
        const [R0, R1] = await pairContract.getReserves();
        const token0 = await pairContract.token0();
        let [RR0, RR1] = (token0.toUpperCase() === token.toUpperCase()) ? [R1, R0] :[R0, R1];
        try {
            for (let i = 0; i < wallets.length; i++) {
                const T1 = new BigNumber(wallets[i].initialTokenAmount + "e" + decimals.toString()).toFixed(0);
                const T0 = await routerContract.getAmountIn(T1, RR0, RR1);
                wallets[i].sim.tokenAmount = T1;
                wallets[i].sim.ethAmount = T0.toString();
                RR0 = RR0.add(T0);
                RR1 = RR1.sub(ethers.BigNumber.from(T1));
            }
            console.log('✔ 2) End calculating eth amount per wallet .');
            
            return { wallets };
        } catch (err) {
            console.log("Error in CalEthAndTokensForBuy ===> ", err);

            if (err.error && err.error.toString().includes("INSUFFICIENT_LIQUIDITY"))
                return { error: "Insufficient liquidity", wallets };
            else if (err.reason && err.reason.toString().includes("INSUFFICIENT_LIQUIDITY"))
                return { error: "Insufficient liquidity", wallets };
            else
                return { error: "Unknown", wallets };
        }
        

    } catch (error) {
        console.log(error);
        return { error: "Unknown" };
    }
}

module.exports = {
    getETHForBuyBundling,
}