var request = require('request');
var listingServiceJson = require("./build/contracts/ListingService.json");
var listingServiceAddress = "0xDdB8C99DDde24195C6155463a1bc7ca95E42c883";

function ensCategories() {
    return [
        { id: 0, name: '<Not Categorized>' },
        { id: 1, name: 'Adult' },
        { id: 2, name: 'Blockchain' },
        { id: 3, name: 'Business' },
        { id: 4, name: 'Common/Well Known' },
        { id: 5, name: 'Entertainment' },
        { id: 6, name: 'Financial' },
        { id: 7, name: 'Fund Raising' },
        { id: 8, name: 'Geography' },
        { id: 9, name: 'Health' },
        { id: 10, name: 'Money' },
        { id: 11, name: 'Name' },
        { id: 12, name: 'Politics' },
        { id: 13, name: 'Shopping' },
        { id: 14, name: 'Social' },
        { id: 15, name: 'Sports and Games' },
        { id: 16, name: 'Technology' },

    ];
}

function submitCategoriesAndKeywords(name, categories, keywords) {
    return new Promise(function (resolve, reject) {
        request.post(
            'https://enslisting.com/api/recordlistingmetadata',
            { form: { name: name, categories: categories, keywords: keywords } },
            function (error, response, body) {
                if (error !== null) {
                    return reject(error);
                }
                resolve(body);
            }
        );
    });
}

function enslistingContract(web3) {
    return web3.eth.contract(listingServiceJson.abi).at(listingServiceAddress);
}

module.exports = {
    submitCategoriesAndKeywords: function (name, categories, keywords) {
        return submitCategoriesAndKeywords(name, categories, keywords);
    },
    ensCategories: function () {
        return ensCategories();
    },
    enslistingContract: function (web3) {
        return enslistingContract(web3);
    }

}

