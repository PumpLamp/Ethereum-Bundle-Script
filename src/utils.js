const ethers = require('ethers')
const fs = require("fs")
const { GAS_OPTIONS } = require("./constants")

const xBigNumber = (value, num, den) => {
    return ethers.BigNumber.from(value.toString()).mul(ethers.BigNumber.from(num.toString())).div(ethers.BigNumber.from(den.toString()));
}

const readJSONFromFile = (filePath) => {
    try {
        const data = fs.readFileSync(filePath, 'utf-8');
        // return JSON.parse(JSON.stringify(data))
        return JSON.parse(data);
    } catch (error) {
        console.error("Error reading JSON file:");
        return null;
    }
}

const writeJSONToFile = (filePath, data) => {
    try {
        const jsonString = JSON.stringify(data, null, 2);
        fs.writeFileSync(filePath, jsonString, "utf-8")
        console.log("JSON data written to file successfully")
    } catch (error) {
        console.log("Error writing JSON data to file", error)
    }
}

const generateNewWallet = () => {
    try {

        const wallet = ethers.Wallet.createRandom();
        const privKey = wallet.privateKey;
        const address = wallet.address;
        return { privKey, address }
    } catch (error) {
        console.log(error)
        return null
    }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * 
 * @param {string} error 
 * @returns eth amount needed for bundling.
 */
const parseSimulationError = (error) => {
    try {
        const message = error.toString();
        const msgList1 = message.split(" have ");
        if (msgList1.length >= 2) {
            const msgList2 = msgList1[1].split(" want ");
            if (msgList2.length >= 2) {
                const msgList3 = msgList2[1].split("; ");
                if (msgList3.length >= 2) {
                    const balance = ethers.BigNumber.from(msgList2[0]);
                    const needAmount = ethers.BigNumber.from(msgList3[0]);
                    return needAmount.sub(balance);
                }
                else {
                    const balance = ethers.BigNumber.from(msgList2[0]);
                    const needAmount = ethers.BigNumber.from(msgList2[1]);
                    return needAmount.sub(balance);
                }
            }
        }
    }
    catch (err) {
        console.log("parseSimulationError ===> ", err);
    }
    return null;
};

const _transferAllEthFromAccount = async (provider, account, target) => {
    try {
        // console.log("Transferring:", account.address, "->", target);
        const balance = await account.getBalance();
        if (balance.gt(ethers.BigNumber.from("0"))) {
            const tx = {
                to: target,
                value: balance.toString()
            };
            const gasLimit = xBigNumber(await provider.estimateGas(tx), GAS_OPTIONS.transfer.limit.num, GAS_OPTIONS.transfer.limit.den);
            const gasPrice = xBigNumber(await provider.getGasPrice(), GAS_OPTIONS.transfer.price.num, GAS_OPTIONS.transfer.price.den);
            const ethAmount = gasPrice.mul(gasLimit);
            if (balance.gt(ethAmount)) {
                res = await account.sendTransaction({
                    to: target,
                    value: balance.sub(ethAmount).toString(),
                    gasPrice: gasPrice.toString(),
                    gasLimit: gasLimit.toString()
                });
                return res;
            }
        }
    }
    catch (err) {
        console.log(err);
    }

    return null;
}

async function refundAllEth(provider, accounts, target) {
    console.log(`Refunding all ETH to ${target}...`);
    let pendingTxResponses = {};
    for (let i in accounts) {
        if (accounts[i])
            pendingTxResponses[i] = await _transferAllEthFromAccount(provider, accounts[i], target);
    }

    for (let i in accounts) {
        if (pendingTxResponses[i])
            await pendingTxResponses[i].wait();
    }

    console.log("Success");
}


module.exports = {
    xBigNumber,
    readJSONFromFile,
    writeJSONToFile,
    generateNewWallet,
    parseSimulationError,
    sleep,
    refundAllEth,
}