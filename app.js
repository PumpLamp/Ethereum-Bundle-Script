const chalk = require("chalk").default;
const { Command, Option } = require('program-commander');
const figlet = require('figlet');
const { simulateOnGanache, simulateOnBundle, sendBundleTransaction, addLiquidity, refundsAllETHFromWallets, sell, sellTokens, sellAllTokens } = require("./src/bot")
const { checkDevWallets, checkPool, checkTradingWallets, checkAll } = require("./src/initialCheck")


/**
 * @summary Send bundled transaction for addliquidity Tx and Txs buying tokens from wallets
 */
async function main() {

    const fig_text = figlet.textSync("Ethereum Bundle Script", {
        font: "ANSI Shadow",
        horizontalLayout: "default",
        verticalLayout: "default",
        width: 150,
        whitespaceBreak: true,
    });

    console.log(chalk.cyanBright.bold(fig_text));
    console.log(chalk.yellowBright.bold("Version: 1.0.0"));

    const program = new Command();
    program
        .version("1.0.0", "-v, --version", "output the current version")
        .helpOption("-h, --help", "display help")
        .description("This script is a bot for sniping tokens when launching your token on EVM")
        .option("--check-dev-wallets", "Get token balance and ETH amount of dev wallets")
        .option("--check-pool", "Check pair infomation after launching token")
        .option("--check-trading-wallets", "Check token balance and ETH amount of trading wallets")
        .option("--check-all", "Check dev wallets, trading wallets, pool infos")
        .option("--simulate", "Simulate bundle process and get ETH amount for zombie wallets")
        .option("--addliquidity", "Add liquidiy to launch token")
        .option("--approve", "Approve token contract for adding liquidity")
        .option("--buy", "Buy tokens with trading wallets")
        .option("--method <methodID>", "Enable trading option")
        .option("--refunds-all-eth", "Refunds all ETH from trading wallets")
        .option("--sell [wallet]", "Sell tokens for wallet addresses seperate comma. e.g. --sell 0x29010,0x28934")
        .option("--sell-all", "Sell tokens all trading wallets")
        .action(async (options) => {
            if (Object.keys(options).length == 0) {
                console.log("Please see command help with `node app.js --help`")
            }
            if (options.checkDevWallets) {
                console.log("🟢 Checking dev wallets before launching token...")
                await checkDevWallets();
                console.log("\n✅ Checking ended.........\n\n")
            }
            if (options.addliquidity) {
                if (options.buy) {
                    let simData = {}
                    console.log("🚀 Add liquidity and buy token bundling...")

                    let isApprove = false
                    if (options.approve) isApprove = true

                    console.log("🟢 Simulate start.........")
                    let { buyWallets, addLiquidity } = await simulateOnGanache(isApprove);
                    console.log("Simulate onGanache Successed.")
                    simData = await simulateOnBundle(buyWallets, addLiquidity, isApprove);
                    console.log("✅ Simulate end.........")

                    if (options.simulate) process.exit(1);

                    console.log("🟢 Token launch and firt buy begin.........")
                    await sendBundleTransaction(simData, addLiquidity, isApprove);
                    console.log("✅ Token launch and first buying end.........")

                    console.log("🚩 Success add liquidity and buy token bundleing...")

                    process.exit(1);
                } else {
                    console.log("🟢 Add Only liquidiy ...")
                    if (options.approve)
                        await addLiquidity(true);
                    else
                        await addLiquidity(false);
                    console.log("✅ Add liquidity ended.........")
                }
            }
            if (options.method) {
                try {
                    let simData = {}
                    console.log("🚀 Enable trading and buy token bundling...")

                    let isApprove = false
                    if (options.approve) isApprove = true
                    let methodID = options.method;
                    console.log("🟢 Simulate start.........")
                    let { buyWallets, addLiquidity } = await simulateOnGanache(isApprove, false, methodID);
                    console.log("Simulate onGanache Successed.")
                    simData = await simulateOnBundle(buyWallets, null, isApprove, methodID);
                    console.log("✅ Simulate end.........")

                    if (options.simulate) process.exit(1);

                    console.log("🟢 Enable trading and firt buy begin.........")
                    await sendBundleTransaction(simData, null, isApprove, options.method);
                    console.log("✅ Enable trading and first buying end.........")

                    console.log("🚩 Success enable trading and buy token bundleing...")

                    process.exit(1);
                } catch (error) {
                    console.log("Enable trading and first buy Error: ", error);
                }
            }
            if (options.buy) {
                try {
                    let simData = {}
                    console.log("🚀 Starting to buy token bundling...")

                    let isApprove = false
                    if (options.approve) isApprove = true

                    console.log("🟢 Simulate start.........")
                    let { buyWallets, addLiquidity } = await simulateOnGanache(isApprove, false, null);

                    console.log("Simulate onGanache Successed.")
                    simData = await simulateOnBundle(buyWallets, null, false, null);
                    console.log("✅ Simulate end.........")

                    if (options.simulate) process.exit(1);

                    console.log("🟢 Enable trading and firt buy begin.........")
                    await sendBundleTransaction(simData, null, false, null);
                    console.log("✅ Enable trading and first buying end.........")

                    console.log("🚩 Success to buy token bundleing...")

                    process.exit(1);
                } catch (error) {
                    console.log("Buy token Error: ", error);
                }
            }
            if (options.sell) {
                if (options.sell) {
                    console.log("🚀 Starting to sell token bundling...")
                    let sellWallets = options.sell.split(",");
                    await sellTokens(sellWallets)
                    console.log("🚩 End to sell token bundling...")
                } else {
                    console.log("Please input address of wallets seperated with comma")
                }
            }
            if (options.sellAll) {
                console.log("🚀 Starting to sell tokens in all trading wallets...")
                await sellAllTokens();
                console.log("🚩 End to sell token in all trading wallets...")
            }
            if (options.checkPool) {
                console.log("🟢 Checking pair for tokens...")
                await checkPool();
                console.log("\n✅ Checking ended.........\n\n")
            }
            if (options.checkTradingWallets) {
                console.log("🟢 Checking trading wallets before selling your tokens...")
                await checkTradingWallets();
                console.log("\n✅ Checking ended.........\n\n")
            }
            if (options.checkAll) {
                console.log("🟢 Checking needed infos...")
                await checkAll();
                console.log("\n✅ Checking ended.........\n\n")
            }
            if (options.refundsAllEth) {
                refundsAllETHFromWallets()
            }
        })
    program.parse(process.argv).opts();

}

main()