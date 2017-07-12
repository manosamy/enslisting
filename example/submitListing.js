var enslisting = require('../index.js');
var Web3 = require('web3');
var TIP_AMT = 0.005; //ethers

//Initialize web3
var web3 = new Web3();
web3.setProvider(new web3.providers.HttpProvider('http://localhost:8545')); 

//Select the correct account that owns the domains, else, the submission will fail and you will lose your txn fee.
var DOMAIN_OWNER_ACCOUNT = web3.eth.accounts[7];
//remember to unlock the account first in geth using
//personal.unlockAccount(eth.accounts[7])

console.log("Owner Account:" + DOMAIN_OWNER_ACCOUNT);
console.log("all Accounts:" + web3.eth.accounts);

console.log("Ens Categories: " + JSON.stringify(enslisting.ensCategories()));

//Get reference to enslisting contract
var listingContract = enslisting.enslistingContract(web3);

//first submit metadata to enslisting.com website
enslisting.submitCategoriesAndKeywords("privatebit", "2,4", "private bit")
    .then(function (response) {
        console.log(response); //response should be "successful"
    }).then(function () {
        //Submit listing transaction to mainnet
        console.log("submitting transaction to mainnet");
        return listingContract.addListing(
            'privatebit', //Domain name you are listing, without .eth
            'ensreseller@gmail.com', //email address, optional, give '' if you want to be anonymous @gmail.com can be omitteds
            web3.toWei(1.1, "ether").valueOf(), //list price, in ethers
            { from: DOMAIN_OWNER_ACCOUNT, value: web3.toWei(TIP_AMT, "ether"), gas: 600000 }); //tip amount in ethers
    }).then(function (listingTxnHash) {
        console.log(`Listing transaction hash: ${listingTxnHash}`);
        console.log("Verify status of this one trasnaction by visiting");
        console.log(`https://etherscan.io/tx/${listingTxnHash}`);
        console.log("Or review all recent listings by visiting");
        console.log(`https://etherscan.io/address/${listingContract.address}`);
    });
