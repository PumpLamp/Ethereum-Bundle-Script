const chainNames = {
    1: "mainnet",
    11155111: "sepolia",
}

const BRIBE_CONTRACT_ADDR = {
    "eth": "0x73C9321ab67177C3005Dcd273009737482c45Ce8",
    "sepolia": "0x89C4d4c9bD8c44c7ba5B52057fDCdF740765d98C"
}

const UNISWAP_V2_ROUTER = {
    eth: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
    base: "0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24",
    goerli: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
    sepolia: "0xC532a74256D3Db42D0Bf7a0400fEFDbad7694008",
};

const WETH = {
    eth: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    base: "0x4200000000000000000000000000000000000006",
    goerli: "0xB4FBF271143F4FBf7B91A5ded31805e42b2208d6",
    sepolia: "0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9",
};

const BRIBE_ETH = "0.05"

const GOLIVE_CONTRACT_ADDR = {
    eth: "0xED9E67ef7A90757A1C163d86aDc6b9cd7A930Cef",
    sepolia: "0xf4B4E98b7b5f71558c2780F262Ff7539701257Ae"
}

const DISPERSE_CONTRACT_ADDR = {
    eth: "0xD152f549545093347A162Dce210e7293f1452150",
    sepolia: "0xe1cD2C08009d7f78c01d4a654d00EeaD5Bf2a9fd"
}

const GAS_OPTIONS = {
    buy: {
        limit: {
            num: 200,
            den: 100,
        },
        price: {
            num: 150,
            den: 100,
        }
    },
    sell: {
        limit: {
            num: 130,
            den: 100,
        },
        price: {
            num: 120,
            den: 100,
        }
    },
    transfer: {
        limit: {
            num: 100,
            den: 100,
        },
        price: {
            num: 120,
            den: 100,
        }
    }
}

module.exports = {
    chainNames,    
    BRIBE_CONTRACT_ADDR,
    UNISWAP_V2_ROUTER,
    WETH,
    BRIBE_ETH,
    GOLIVE_CONTRACT_ADDR,
    DISPERSE_CONTRACT_ADDR,
    GAS_OPTIONS
}