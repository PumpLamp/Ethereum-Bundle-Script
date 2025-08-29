const dotenv = require("dotenv");
const ethers = require("ethers");
const DEGToken = require("../abi/DegentralizedToken.json")
const { getETHForBuyBundling } = require('./onGanache');
const { readJSONFromFile, writeJSONToFile, generateNewWallet, parseSimulationError, xBigNumber, sleep, refundAllEth } = require("./utils");
const { FlashbotsBundleProvider } = require("@flashbots/ethers-provider-bundle")
const fs = require("fs");
const { UNISWAP_V2_ROUTER, BRIBE_ETH, BRIBE_CONTRACT_ADDR, WETH, GOLIVE_CONTRACT_ADDR, GAS_OPTIONS } = require("./constants");
const UniswapV2Router02ABI = require('@uniswap/v2-periphery/build/UniswapV2Router02.json');
const bribeABI = require("../assets/coinbase.json")
const goliveABI = require("../abi/IGoLive.json")
const ethProvider = new ethers.providers.JsonRpcProvider(process.env.CHAIN_RPC_HTTP_URL)
const routerABI = UniswapV2Router02ABI.abi;
const tokenABI = DEGToken.abi;

const authSigner = new ethers.Wallet(
    '0x2000000000000000000000000000000000000000000000000000000000000000',
    ethProvider
);

let flashbotsProvider;

dotenv.config()

let wallets = [];
let zombies = [];
let amountTokenForLiquidity;
let amountEthForLiquidity;

// Check and Set initial values
async function setVariables() {
    console.log("🧨 Getting variables...")
    try {
        if (process.env.CHAINID !== '1' && process.env.CHAINID !== '11155111') {
            console.log("❌ Wrong CHAINID value. CHAINID should be 1 or 11155111")
            return false
        }
        if (process.env.CHAINNAME !== 'eth' && process.env.CHAINNAME !== 'sepolia') {
            console.log("❌ Wrong CHAINNAME value. CHAINNAME should be 'eth' or 'sepolia'")
            return false
        }
        if (process.env.CHAIN_RPC_HTTP_URL.length === 0 || process.env.CHAIN_RPC_HTTP_URL.startsWith("https://") === false) {
            console.log("Wrong CHAIN_RPC_HTTP_URL value. Please enter a correct CHAIN_RPC_HTTP_URL value.")
            return false
        }
        if (process.env.CHAIN_FLASHBOT_URL.length === 0 || process.env.CHAIN_FLASHBOT_URL.startsWith("https://") === false) {
            console.log("Wrong CHAIN_FLASHBOT_URL value. Please enter a correct CHAIN_FLASHBOT_URL value.")
            return false
        }
        if (process.env.WALLET_DIST_COUNT.length === 0 || Number(process.env.WALLET_DIST_COUNT) < 1) {
            console.log("Wrong WALLET_DIST_COUNT value. Please enter a correct WALLET_DIST_COUNT value.")
            return false
        }
        if (process.env.TOKEN_AMOUNTS_PER_WALLET.length === 0 || process.env.TOKEN_AMOUNTS_PER_WALLET.split(",").length !== Number(process.env.WALLET_DIST_COUNT)) {
            console.log("Wrong TOKEN_AMOUNTS_PER_WALLET value. Please enter a WALLET_DIST_COUNT token amounts with ','.")
            return false
        }
        if (process.env.ETH_FOR_LIQUIDITY.length === 0 || Number(process.env.ETH_FOR_LIQUIDITY) <= 0) {
            console.log("Wrong ETH_FOR_LIQUIDITY value. Please enter a correct ETH_FOR_LIQUIDITY value.")
            return false
        }
        if (process.env.TOKEN_FOR_LIQUIDITY.length === 0 || Number(process.env.TOKEN_FOR_LIQUIDITY) <= 0) {
            console.log("Wrong TOKEN_FOR_LIQUIDITY value. Please enter a correct TOKEN_FOR_LIQUIDITY value.")
            return false
        }
        const zombiePrivateKeys = process.env.ZOMBIES.split(",")
        if (zombiePrivateKeys.length !== 2) {
            console.log("Error: Zombies length should be 2.")
            return false
        }

        let decimals = 0

        try {
            const tokenContract = new ethers.Contract(process.env.TOKEN_ADDRESS, tokenABI, ethProvider)
            flashbotsProvider = await FlashbotsBundleProvider.create(
                ethProvider,
                authSigner,
                process.env.CHAIN_FLASHBOT_URL,
                process.env.CHAINNAME
            );

            try {
                decimals = await tokenContract.decimals()
            } catch (err) {
                console.log(err)
                return false
            }
        } catch (err) {
            console.log("Wrong token address. Please make sure if this token is on your chain.")
            return false
        }
        zombies.push(new ethers.Wallet(zombiePrivateKeys[0], ethProvider))
        zombies.push(new ethers.Wallet(zombiePrivateKeys[1], ethProvider))
        amountTokenForLiquidity = ethers.utils.parseUnits(process.env.TOKEN_FOR_LIQUIDITY, decimals); // Amount of your token
        amountEthForLiquidity = ethers.utils.parseUnits(process.env.ETH_FOR_LIQUIDITY, 18); // Amount of ETH
        console.log("✔ Parsed .env file successfully...")
        return true
    } catch (err) {
        console.log('Error in parsing .env file: ', err)
        return false
    }
}

// Generate wallets to buy token.
async function generateWallets() {
    console.log("🧨 Generating wallets...")
    if (wallets.length == 0) {
        // function Wallet(wallet) {
        //     this.Address = wallet.address;
        //     this.EthAmount = wallet.balance;
        //     this.TokenAmount = wallet.token;
        // }

        let walletsInfo;
        try {
            if (!fs.existsSync("wallets.json")) {
                console.log('Not exist wallet.json file')
                fs.writeFileSync("wallets.json", "", "utf-8");
            }
            walletsInfo = readJSONFromFile("wallets.json")
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
            console.table(walletsInfo)
            writeJSONToFile("wallets.json", walletsInfo);
        }
        const tokenAmounts = process.env.TOKEN_AMOUNTS_PER_WALLET.split(",")
        for (let i = 0; i < process.env.WALLET_DIST_COUNT; i++) {
            const _wallet = {
                address: walletsInfo[i].address,
                privateKey: walletsInfo[i].privateKey,
                initialTokenAmount: tokenAmounts[i],
                sim: {
                    tokenAmount: "",
                    ethAmount: "",
                    disperseAmount: "",
                }
            }
            wallets.push(_wallet)
        }
    }
    console.log("✔ Generated wallets successfully...")
}

async function init() {
    await setVariables();
    try {
        if (!fs.existsSync("wallets.json")) {
            await generateWallets();
        }
        walletsInfo = readJSONFromFile("wallets.json")
    } catch (error) {
        console.log("wallets.json file doesn't exist.", error);
    }

    console.log("✅ Wallets loaded from wallets.json file successfully.");
    console.table(walletsInfo);

    const tokenAmounts = process.env.TOKEN_AMOUNTS_PER_WALLET.split(",")
    for (let i = 0; i < process.env.WALLET_DIST_COUNT; i++) {
        const _wallet = {
            address: walletsInfo[i].address,
            privateKey: walletsInfo[i].privateKey,
            initialTokenAmount: tokenAmounts[i],
            sim: {
                tokenAmount: "",
                ethAmount: "",
                disperseAmount: "",
            }
        }
        wallets.push(_wallet)
    }
}
/**
 * @summary Calculate ETH amount and GAS price for addliquidity and buy transaction.
 * @returns eth amount for addliquidity, eth amount to buy per wallets
 */
async function simulateOnGanache(approve = true, addliquidity = true, methodID = null) {
    console.log("initializing...")
    await init();
    const tokenContract = new ethers.Contract(process.env.TOKEN_ADDRESS, tokenABI, zombies[0]);
    let { wallets: buyWallets, addLiquidity } = await getETHForBuyBundling(Number(process.env.CHAINID), tokenContract.address, wallets, zombies, 0, addliquidity, approve, methodID);
    return { buyWallets, addLiquidity }
}

async function simulateOnBundle(buyWallets, addLiquidity, approve = true, methodID = null) {
    // await init();

    // This is tx arrays to bundle.
    let bundleTx = [];
    const routerContract = new ethers.Contract(UNISWAP_V2_ROUTER[process.env.CHAINNAME], routerABI, zombies[0]);
    const tokenContract = new ethers.Contract(process.env.TOKEN_ADDRESS, tokenABI, zombies[0]);
    const feeData = await ethProvider.getFeeData();
    const maxFeePerGas = feeData.maxFeePerGas;
    const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas;

    try {
        // STEP 1. Calculating eth amount for zombie 0.
        console.log("🧨 1. Calculating eth amount for zombie #0 ");
        let tx;
        let args;
        // First tx is Bribe tx that used in order to use bundle provider.
        let bribeWei = ethers.utils.parseEther(BRIBE_ETH).toString();
        const bribeContract = new ethers.Contract(BRIBE_CONTRACT_ADDR[process.env.CHAINNAME], bribeABI, zombies[0]);
        args = [{ value: bribeWei }]
        let bribeTx = await bribeContract.populateTransaction.execute(...args);
        let bribeTxGasLimit = await bribeContract.estimateGas.execute(...args);
        tx = {
            chainId: process.env.CHAINID,
            type: 2,
            maxFeePerGas,
            maxPriorityFeePerGas,
            gasLimit: bribeTxGasLimit,
            data: bribeTx.data,
            to: bribeTx.to,
            value: bribeWei,
        }
        bundleTx.push({
            signer: zombies[0],
            transaction: tx,
        })

        if (addLiquidity) {
            console.log("add liquidity is not null")
            // Second tx is approve tx that must to be excuted before sending add liquidity tx.
            if (approve) {
                args = [
                    UNISWAP_V2_ROUTER[process.env.CHAINNAME],
                    ethers.constants.MaxUint256,
                ];
                const approveTx = await tokenContract.populateTransaction.approve(...args);
                const approveGasLimit = await tokenContract.estimateGas.approve(...args);
                tx = {
                    chainId: process.env.CHAINID,
                    type: 2,
                    maxFeePerGas,
                    maxPriorityFeePerGas,
                    gasLimit: approveGasLimit,
                    data: approveTx.data,
                    to: approveTx.to,
                }
                bundleTx.push({
                    signer: zombies[0],
                    transaction: tx,
                })
            }

            // Third tx is add liquidity tx.
            args = [
                process.env.TOKEN_ADDRESS,
                amountTokenForLiquidity,
                0,
                0,
                zombies[0].address,
                parseInt(Date.now() / 1000) + 1200,
                { value: amountEthForLiquidity }
            ];
            const addLiquidityTx = await routerContract.populateTransaction.addLiquidityETH(...args);
            tx = {
                chainId: process.env.CHAINID,
                type: 2,
                maxFeePerGas,
                maxPriorityFeePerGas,
                gasLimit: addLiquidity.gasLimit,
                data: addLiquidityTx.data,
                to: addLiquidityTx.to,
                value: amountEthForLiquidity.toString(),
            }
            bundleTx.push({
                signer: zombies[0],
                transaction: tx,
            })
        }
        if (methodID) {
            // enable opentrading
            tx = {
                chainId: process.env.CHAINID,
                type: 2,
                maxFeePerGas,
                maxPriorityFeePerGas,
                gasLimit: ethers.utils.hexlify(200000),
                to: process.env.TOKEN_ADDRESS,
                data: methodID,
            }

            bundleTx.push({
                signer: zombies[0],
                transaction: tx,
            })
        }

        // Bundling txs that must be excuted by zombie wallet0
        const _singledTxBundle = await flashbotsProvider.signBundle(bundleTx);
        const _blockNumber = await ethProvider.getBlockNumber();
        const _simulation = await flashbotsProvider.simulate(_singledTxBundle, _blockNumber + 1);
        let zombieAmount0 = '0';
        if (_simulation.error) {
            zombieAmount0 = parseSimulationError(_simulation.error.message);
        }

        // STEP 2. Calculating eth amount to disperse
        // Re simulate when bundling.
        console.log("🧨 2. Calculating eth amount to disperse for zombie #1...")
        for (let i = 0; i < buyWallets.length; i++) {
            let _wallet = new ethers.Wallet(buyWallets[i].privateKey, ethProvider);
            let _router = new ethers.Contract(UNISWAP_V2_ROUTER[process.env.CHAINNAME], routerABI, _wallet);
            let _deadline = Math.floor(Date.now() / 1000) + 60 * 20;
            args = [
                buyWallets[i].sim.tokenAmount,
                [WETH[process.env.CHAINNAME], process.env.TOKEN_ADDRESS],
                _wallet.address,
                _deadline,
                { value: buyWallets[i].sim.ethAmount.toString() }
            ]
            const buyTx = await _router.populateTransaction.swapETHForExactTokens(...args);
            tx = {
                chainId: process.env.CHAINID,
                type: 2,
                maxFeePerGas,
                maxPriorityFeePerGas,
                gasLimit: buyWallets[i].sim.gasLimit.toString(),
                data: buyTx.data,
                to: buyTx.to,
                value: buyWallets[i].sim.ethAmount.toString()
            }
            const singledTxBundle = await flashbotsProvider.signBundle([{
                signer: _wallet,
                transaction: tx,
            }])
            const blockNumber = await ethProvider.getBlockNumber();

            try {
                const simulation = await flashbotsProvider.simulate(singledTxBundle, blockNumber + 1);
                if (simulation.error) {
                    const ethAmount = parseSimulationError(simulation.error.message);
                    buyWallets[i].sim.disperseAmount = (buyWallets[i].initialEthAmount != "") ?
                        ethAmount.add(ethers.utils.parseEther(buyWallets[i].initialEthAmount)) : ethAmount
                } else
                    wallets[i].sim.disperseAmount = ""
            } catch (error) {
                console.log("❌ No support simulation:", error)
            }
        }

        // console.log("Calculating eth amount for zombie #1");

        let zombieAmount1 = "0";
        let disperseTotalAmount = ethers.BigNumber.from("0");
        let disperseEthAmounts = [];
        let disperseAddresses = [];
        for (let i = 0; i < buyWallets.length; i++) {
            if (buyWallets[i].sim.disperseAmount !== "") {
                disperseAddresses = [
                    ...disperseAddresses,
                    buyWallets[i].address
                ];
                disperseEthAmounts = [
                    ...disperseEthAmounts,
                    buyWallets[i].sim.disperseAmount,
                ]
                disperseTotalAmount = disperseTotalAmount.add(buyWallets[i].sim.disperseAmount);
                buyWallets[i].sim.disperseAmount = buyWallets[i].sim.disperseAmount.toString();
            }
        }
        if (disperseEthAmounts.length > 0) {
            const goliveContract = new ethers.Contract(GOLIVE_CONTRACT_ADDR[process.env.CHAINNAME], goliveABI, zombies[1]);
            const args = [disperseAddresses, disperseEthAmounts];
            const initialGasLimit = ethers.BigNumber.from("450000").toString();
            const handle = await goliveContract.populateTransaction.handle(...args, { value: disperseTotalAmount })
            tx = {
                chainId: process.env.CHAINID,
                type: 2,
                maxFeePerGas,
                maxPriorityFeePerGas,
                gasLimit: initialGasLimit,
                data: handle.data,
                to: handle.to,
                value: disperseTotalAmount,
            }
            const bundledTx = [{
                signer: zombies[1],
                transaction: tx
            }]
            try {
                const signedTxBundle = await flashbotsProvider.signBundle(bundledTx);
                const blockNumber = await ethProvider.getBlockNumber();
                const simulation = await flashbotsProvider.simulate(signedTxBundle, blockNumber + 1);
                if (simulation.error) {
                    zombieAmount1 = parseSimulationError(simulation.error.message)
                    if (zombieAmount1)
                        zombieAmount1 = zombieAmount1.add(ethers.utils.parseEther(BRIBE_ETH)).add(ethers.utils.parseEther("0.1"));
                }
            } catch (error) {
                console.log("No support simulation:", error);
            }
        }

        console.table([
            {
                wallet: 'dev wallet 0',
                address: zombies[0].address,
                diffETH: ethers.BigNumber.from(zombieAmount0.toString()) / 1e18
            },
            {
                wallet: 'dev wallet 1',
                address: zombies[1].address,
                diffETH: ethers.BigNumber.from(zombieAmount1.toString()) / 1e18
            }
        ])

        if (!zombieAmount0 || !zombieAmount1) {
            return {
                error: "Unknown",
                buyWallets,
            };
        }

        return {
            zombies: [
                {
                    address: zombies[0].address,
                    value: zombieAmount1.toString()
                },
                {
                    address: zombies[1].address,
                    value: zombieAmount1.toString()
                }
            ],
            disperseAmount: disperseTotalAmount.toString(),
            buyWallets,
            maxFeePerGas: maxFeePerGas.toString(),
            maxPriorityFeePerGas: maxPriorityFeePerGas.toString(),
        }

    } catch (error) {
        console.log("❌ Failed simulation...", error)
    }
}

async function sendBundleTransaction(simData, addLiquidity, approve = true, methodID = null) {
    console.log("1. Dispersing ETH...")
    let userAddress = [];
    let userAmounts = [];
    let tx;
    for (let i = 0; i < simData.buyWallets.length; i++) {
        if (
            simData.buyWallets[i].sim.disperseAmount != "" &&
            simData.buyWallets[i].sim.disperseAmount != "0"
        ) {
            userAddress.push(simData.buyWallets[i].address);
            userAmounts.push(simData.buyWallets[i].sim.disperseAmount);
        }
    }
    console.log("Disperse User Info:", userAddress, userAmounts);
    const num = 150;
    const den = 100;
    if (userAddress.length > 0) {
        console.log("Dispersing ETH from zombie wallet #1 to user wallets...")
        const goliveContract = new ethers.Contract(GOLIVE_CONTRACT_ADDR[process.env.CHAINNAME], goliveABI, zombies[1]);
        const args = [userAddress, userAmounts];
        const gasLimit = await goliveContract.estimateGas.handle(...args, { value: simData.disperseAmount })
        const gasPrice = xBigNumber(await ethProvider.getGasPrice(), num, den)
        tx = await goliveContract.handle(
            ...args,
            {
                gasLimit: gasLimit,
                gasPrice: gasPrice,
                value: simData.disperseAmount
            }
        )
        await tx.wait();
    }
    console.log("Disperse ETH Successfully.")

    console.log("Generating Bundle...")
    let bundledTx = [];
    let gas = 0;
    const { maxFeePerGas, maxPriorityFeePerGas } = simData;
    // 1. bribe tx
    const bribeWei = ethers.utils.parseEther(BRIBE_ETH).toString();
    const bribeContract = new ethers.Contract(BRIBE_CONTRACT_ADDR[process.env.CHAINNAME], bribeABI, zombies[0])
    let args = [{ value: bribeWei }];
    const execute = await bribeContract.populateTransaction.execute(...args);
    const gasLimit = (await bribeContract.estimateGas.execute(...args)).toString();
    tx = {
        chainId: process.env.CHAINID,
        type: 2,
        maxFeePerGas,
        maxPriorityFeePerGas,
        gasLimit: gasLimit,
        data: execute.data,
        to: execute.to,
        value: bribeWei
    }
    gas += parseInt(gasLimit.toString());
    bundledTx.push({
        signer: zombies[0],
        transaction: tx,
    })

    // 2. approve tx
    if (approve) {
        args = [UNISWAP_V2_ROUTER[process.env.CHAINNAME], ethers.constants.MaxUint256];
        const tokenContract = new ethers.Contract(process.env.TOKEN_ADDRESS, tokenABI, zombies[0])
        const approve_tx = await tokenContract.populateTransaction.approve(...args);
        const approveGasLimit = await tokenContract.estimateGas.approve(...args);
        tx = {
            chainId: process.env.CHAINID,
            type: 2,
            maxFeePerGas,
            maxPriorityFeePerGas,
            gasLimit: approveGasLimit,
            data: approve_tx.data,
            to: approve_tx.to,
        }
        gas + parseInt(approveGasLimit.toString());
        bundledTx = [
            ...bundledTx,
            {
                signer: zombies[0],
                transaction: tx,
            }
        ]
    }

    // 3. add liquidity tx 
    if (addLiquidity) {
        console.log("bundling runnig addLiquidity is not null")
        args = [
            process.env.TOKEN_ADDRESS,
            amountTokenForLiquidity.toString(),
            0,
            0,
            zombies[0].address,
            parseInt(Date.now() / 1000) + 1200,
            { value: amountEthForLiquidity.toString() }
        ]
        const router = new ethers.Contract(UNISWAP_V2_ROUTER[process.env.CHAINNAME], routerABI, zombies[0])
        const addLiquidityTx = await router.populateTransaction.addLiquidityETH(...args)

        tx = {
            chainId: process.env.CHAINID,
            type: 2,
            maxFeePerGas,
            maxPriorityFeePerGas,
            gasLimit: addLiquidity.gasLimit,
            data: addLiquidityTx.data,
            to: addLiquidityTx.to,
            value: amountEthForLiquidity.toString()
        }
        bundledTx.push({
            signer: zombies[0],
            transaction: tx
        })
    }

    // 3.1 enable OpenTrading.
    if (methodID) {
        tx = {
            chainId: process.env.CHAINID,
            type: 2,
            maxFeePerGas: maxFeePerGas,
            maxPriorityFeePerGas: maxPriorityFeePerGas,
            gasLimit: ethers.utils.hexlify(200000),
            to: process.env.TOKEN_ADDRESS,
            data: methodID,
        }
        bundledTx.push({
            signer: zombies[0],
            transaction: tx
        })
    }

    // 4. buyWallet's buy txs
    for (let i = 0; i < simData.buyWallets.length; i++) {
        let _wallet = new ethers.Wallet(simData.buyWallets[i].privateKey, ethProvider);

        let _router = new ethers.Contract(UNISWAP_V2_ROUTER[process.env.CHAINNAME], routerABI, _wallet);
        let _deadline = Math.floor(Date.now() / 1000) + 60 * 20;

        args = [
            simData.buyWallets[i].sim.tokenAmount,
            [WETH[process.env.CHAINNAME], process.env.TOKEN_ADDRESS],
            _wallet.address,
            _deadline,
            { value: simData.buyWallets[i].sim.ethAmount.toString() }
        ]
        const buyTx = await _router.populateTransaction.swapETHForExactTokens(...args)

        tx = {
            chainId: process.env.CHAINID,
            type: 2,
            maxFeePerGas,
            maxPriorityFeePerGas,
            gasLimit: simData.buyWallets[i].sim.gasLimit.toString(),
            data: buyTx.data,
            to: buyTx.to,
            value: simData.buyWallets[i].sim.ethAmount.toString()
        }
        gas = gas + parseInt(simData.buyWallets[i].sim.gasLimit.toString());
        bundledTx.push({
            signer: _wallet,
            transaction: tx,
        });
    }

    await _sendAndConfirmBundle(bundledTx);
}

async function _sendAndConfirmBundle(bundledTx) {
    let error
    let successed = false;
    let abort = false;
    let oldBlockNumber = 0;
    let firstBlockNumber = 0;

    const signedTransactions = await flashbotsProvider.signBundle(bundledTx);
    while (!abort) {
        let blockNumber = await ethProvider.getBlockNumber();
        while (oldBlockNumber !== 0 && oldBlockNumber === blockNumber) {
            await sleep(1000);
            blockNumber = await ethProvider.getBlockNumber();
        }
        oldBlockNumber = blockNumber;
        if (firstBlockNumber === 0) firstBlockNumber = blockNumber;

        const simulation = await flashbotsProvider.simulate(signedTransactions, blockNumber + 1)

        if (simulation.results) {
            error = null;
            for (let i = 0; i < simulation.results.length; i++) {
                if ("error" in simulation.results[i]) {
                    error = simulation.results[i];
                    break;
                }
            }
            console.log("❌ error ===>", error)
            if (!error) {
                const bundleTxRes = await flashbotsProvider.sendRawBundle(signedTransactions, blockNumber + 1);
                await bundleTxRes.wait();
                const receipts = await bundleTxRes.receipts()
                console.log("✔ response ===>", receipts)
                for (let i = 0; i < receipts.length; i++) {
                    if (receipts[i] === null) break
                    successed = true
                    abort = true
                }
            }
        }
    }

    if (successed) {
        console.log("✅ Bundled successfully!")
    } else {
        console.log("❌ Bundled failed!")
    }
}

async function addLiquidity(approve = true) {
    await init();
    try {
        // approve for add liquidiy.
        if (approve) {
            let args = [UNISWAP_V2_ROUTER[process.env.CHAINNAME], ethers.constants.MaxUint256];
            const tokenContract = new ethers.Contract(process.env.TOKEN_ADDRESS, tokenABI, zombies[0])
            const approveTx = await tokenContract.approve(...args);
            await approveTx.wait();
        }

        // Third tx is add liquidity tx.
        args = [
            process.env.TOKEN_ADDRESS,
            amountTokenForLiquidity,
            0,
            0,
            zombies[0].address,
            parseInt(Date.now() / 1000) + 1200,
            { value: amountEthForLiquidity }
        ];
        const routerContract = new ethers.Contract(UNISWAP_V2_ROUTER[process.env.CHAINNAME], routerABI, zombies[0]);
        const addLiquidityTx = await routerContract.addLiquidityETH(...args);
        await addLiquidityTx.wait();
    } catch (error) {
        console.log("Add liquidity Error: ", error)
    }
}

async function disperseETH(wallets, provider, token) {
    let userAddress = [];
    let userAmounts = [];

    const num = 150;
    const den = 100;
    try {
        for (let wallet of wallets) {
            const account = new ethers.Wallet(wallet.privateKey, provider);
            const balance = await account.getBalance();
            let balance_num = balance.toString() / 1e18;
            // console.log("Balance ===", balance.toString()/1e18)
            if (balance_num < 0.01) {
                userAddress.push(account.address)
                userAmounts.push(ethers.utils.parseUnits("0.01", "ether").toString())
            }
        }
        let disperseTotalAmount = ethers.utils.parseUnits(`${0.01 * wallets.length}`, "ether");
        const goliveContract = new ethers.Contract(GOLIVE_CONTRACT_ADDR[process.env.CHAINNAME], goliveABI, zombies[1]);
        const args = [userAddress, userAmounts];
        const gasLimit = await goliveContract.estimateGas.handle(...args, { value: disperseTotalAmount })

        const gasPrice = xBigNumber(await provider.getGasPrice(), num, den)
        tx = await goliveContract.handle(
            ...args,
            {
                gasLimit: gasLimit,
                gasPrice: gasPrice,
                value: disperseTotalAmount
            }
        )
        await tx.wait();
    } catch (error) {
        console.log("Disperse Error: ", error)
    }
}

async function sellTokens(sellWallets) {
    await init();
    try {
        let accounts = {};
        let balances = {};

        let approveTx = [];

        let walletInfos = [];
        for (let pubKey of sellWallets) {
            let walletInfo = wallets.find(item => item.address == pubKey);
            if (walletInfo) walletInfos.push(walletInfo);
        }
        await disperseETH(walletInfos, ethProvider, process.env.TOKEN_ADDRESS);

        for (let walletItem of walletInfos) {
            const account = new ethers.Wallet(walletItem.privateKey, ethProvider);
            accounts[walletItem.address] = account

            const tokenContract = new ethers.Contract(process.env.TOKEN_ADDRESS, tokenABI, account);
            const balance = await tokenContract.balanceOf(account.address);
            if (balance.gt(ethers.BigNumber.from("0"))) {
                balances[walletItem.address] = balance.div(ethers.BigNumber.from("2"));

                const allowance = await tokenContract.allowance(account.address, UNISWAP_V2_ROUTER[process.env.CHAINNAME]);
                if (allowance.lt(balance)) {
                    console.log(`🟢 Approving tokens from ${account.address}...`);
                    const args = [UNISWAP_V2_ROUTER[process.env.CHAINNAME], ethers.constants.MaxUint256.toString()];
                    const gasLimit = xBigNumber(await tokenContract.estimateGas.approve(...args), GAS_OPTIONS.transfer.limit.num, GAS_OPTIONS.transfer.limit.den).toString();
                    const gasPrice = xBigNumber(await ethProvider.getGasPrice(), GAS_OPTIONS.transfer.price.num, GAS_OPTIONS.transfer.price.den).toString();
                    approveTx = [
                        ...approveTx,
                        await tokenContract.approve(...args, { gasLimit, gasPrice })
                    ];
                }
            }
        }

        for (let i = 0; i < approveTx.length; i++)
            await approveTx[i].wait();

        /* Sell Token */
        const feeData = await ethProvider.getFeeData();
        const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas;
        const maxFeePerGas = feeData.maxFeePerGas;
        let bundledTx = [];

        if (zombies[1]) {
            console.log("Making disperse transactions...");

            let disperseAddresses = [];
            let disperseEthAmounts = [];
            let disperseTotalAmount = ethers.BigNumber.from("0");
            for (let walletItem of walletInfos) {
                if (!accounts[walletItem.address] || !balances[walletItem.address])
                    continue;
                const account = accounts[walletItem.address];
                const routerContract = new ethers.Contract(UNISWAP_V2_ROUTER[process.env.CHAINNAME], routerABI, account);

                const args = [balances[account.address], "0", [process.env.TOKEN_ADDRESS, WETH[process.env.CHAINNAME]], account.address, Math.floor(Date.now() / 1000) + 3600];

                const gasLimit = await routerContract.estimateGas.swapExactTokensForETHSupportingFeeOnTransferTokens(...args);

                const swap = await routerContract.populateTransaction.swapExactTokensForETHSupportingFeeOnTransferTokens(...args);

                const tx = {
                    chainId: process.env.CHAINID,
                    type: 2,
                    maxFeePerGas,
                    maxPriorityFeePerGas,
                    gasLimit,
                    data: swap.data,
                    to: swap.to
                };
                const signedTxBundle = await flashbotsProvider.signBundle([
                    {
                        signer: account,
                        transaction: tx
                    }
                ]);
                const blockNumber = await ethProvider.getBlockNumber();
                const simulation = await flashbotsProvider.simulate(signedTxBundle, blockNumber + 1);
                if (simulation.results) {

                }
                else if (simulation.error) {

                    const ethAmount = parseSimulationError(simulation.error.message);
                    disperseAddresses = [
                        ...disperseAddresses,
                        account.address,
                    ];

                    const ethAmount2 = ethAmount.mul(ethers.BigNumber.from("150")).div(ethers.BigNumber.from("100"));
                    disperseEthAmounts = [
                        ...disperseEthAmounts,
                        ethAmount2,
                    ];
                    disperseTotalAmount = disperseTotalAmount.add(ethAmount2);
                }
            }

            if (disperseAddresses.length > 0) {
                // console.log(disperseAddresses, disperseEthAmounts, disperseTotalAmount);
                console.log("🟢 Starting disperse...")
                const goliveContract = new ethers.Contract(GOLIVE_CONTRACT_ADDR[process.env.CHAINNAME], goliveABI, zombies[1]);
                const args = [disperseAddresses, disperseEthAmounts];
                const gasLimit = (await goliveContract.estimateGas.handle(...args, { value: disperseTotalAmount })).toString();
                // const initialGasLimit = ethers.BigNumber.from("450000");
                const handle = await goliveContract.populateTransaction.handle(...args, { value: disperseTotalAmount });
                const tx = {
                    chainId: process.env.CHAINID,
                    type: 2,
                    maxFeePerGas,
                    maxPriorityFeePerGas,
                    gasLimit,
                    value: disperseTotalAmount,
                    data: handle.data,
                    to: handle.to
                };
                bundledTx = [
                    ...bundledTx,
                    {
                        signer: zombies[1],
                        transaction: tx
                    }
                ];
                const gasPrice = (await ethProvider.getGasPrice()).toString();
                const disperseTx = await goliveContract.handle(...args, {
                    gasLimit: gasLimit,
                    gasPrice: gasPrice,
                    value: disperseTotalAmount
                });
                await disperseTx.wait();
                // console.log("✅ End disperse...")
            }
        }

        console.log("🟢 Selling tokens...");
        if (walletInfos.length == 1) {
            const account = accounts[walletInfos[0].address];
            const routerContract = new ethers.Contract(UNISWAP_V2_ROUTER[process.env.CHAINNAME], routerABI, account);
            const args = [balances[account.address], "0", [process.env.TOKEN_ADDRESS, WETH[process.env.CHAINNAME]], account.address, Math.floor(Date.now() / 1000) + 3600];
            const tx = await routerContract.swapExactTokensForETHSupportingFeeOnTransferTokens(...args);
            await tx.wait();
        } else if (walletInfos.length > 1) {
            let bribeWei = ethers.utils.parseEther(BRIBE_ETH).toString();
            const bribeContract = new ethers.Contract(BRIBE_CONTRACT_ADDR[process.env.CHAINNAME], bribeABI, zombies[0]);
            args = [{ value: bribeWei }]
            let bribeTx = await bribeContract.populateTransaction.execute(...args);
            let bribeTxGasLimit = await bribeContract.estimateGas.execute(...args);
            let tx = {
                chainId: process.env.CHAINID,
                type: 2,
                maxFeePerGas,
                maxPriorityFeePerGas,
                gasLimit: bribeTxGasLimit,
                data: bribeTx.data,
                to: bribeTx.to,
                value: bribeWei,
            }
            bundledTx.push({
                signer: zombies[0],
                transaction: tx,
            })
            for (let walletItem of walletInfos) {
                if (!accounts[walletItem.address] || !balances[walletItem.address])
                    continue;

                const account = accounts[walletItem.address];
                const routerContract = new ethers.Contract(UNISWAP_V2_ROUTER[process.env.CHAINNAME], routerABI, account);
                const args = [balances[account.address], "0", [process.env.TOKEN_ADDRESS, WETH[process.env.CHAINNAME]], account.address, Math.floor(Date.now() / 1000) + 3600];
                const gasLimit = await routerContract.estimateGas.swapExactTokensForETHSupportingFeeOnTransferTokens(...args);
                const swap = await routerContract.populateTransaction.swapExactTokensForETHSupportingFeeOnTransferTokens(...args);
                tx = {
                    chainId: process.env.CHAINID,
                    type: 2,
                    maxFeePerGas,
                    maxPriorityFeePerGas,
                    gasLimit,
                    data: swap.data,
                    to: swap.to
                };
                bundledTx = [
                    ...bundledTx,
                    {
                        signer: account,
                        transaction: tx
                    }
                ];
            }

            console.log("🟢 Sending raw bundle...");
            let oldBlockNumber = 0;
            let successed = false;
            const signedTxBundle = await flashbotsProvider.signBundle(bundledTx);
            while (!successed) {
                let blockNumber = await ethProvider.getBlockNumber();
                while (oldBlockNumber !== 0 && oldBlockNumber === blockNumber) {
                    await sleep(1000);
                    blockNumber = await ethProvider.getBlockNumber();
                }

                console.log(`Chain: ${process.env.CHAINNAME}, Current Block: ${blockNumber}`);

                oldBlockNumber = blockNumber;
                const simulation = await flashbotsProvider.simulate(signedTxBundle, blockNumber + 1);
                if (simulation.results) {
                    let error = null;
                    for (let i = 0; i < simulation.results.length; i++) {
                        if ('error' in simulation.results[i]) {
                            console.log(`Simulation Error(Buy): ${simulation.results[i].error}`);
                            error = simulation.results[i];
                            break;
                        }
                    }

                    if (!error) {
                        const bundleTxRes = await flashbotsProvider.sendRawBundle(signedTxBundle, blockNumber + 1);
                        const response = await bundleTxRes.wait();
                        if (!response) {
                            console.log("Success");
                            await refundAllEth(ethProvider, accounts, zombies[1].address);
                            successed = true;
                        }
                    }
                    else {
                        console.log("Second simulation failed:", simulation);
                        break;
                    }
                }
                else {
                    console.log("First simulation failed:", simulation);
                    break;
                }
            }
        }

    }
    catch (err) {
        console.log(err);
    }
}
async function sellAllTokens() {
    await init();
    let walletAddress = wallets.map(item => item.address)
    await sellTokens(walletAddress);
}
async function refundsAllETHFromWallets() {
    await init();
    let accounts = [];
    for (let wallet of wallets) {
        const account = new ethers.Wallet(wallet.privateKey, ethProvider)
        accounts.push(account)
    }
    await refundAllEth(ethProvider, accounts, zombies[1].address)
}

module.exports = {
    simulateOnGanache,
    simulateOnBundle,
    sendBundleTransaction,
    addLiquidity,
    refundsAllETHFromWallets,
    sellTokens,
    sellAllTokens,
}