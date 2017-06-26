//Credits:
//http://staxmanade.com/2015/11/testing-asyncronous-code-with-mochajs-and-es7-async-await/

var mochaAsync = (fn) => {
    return async () => {
        try {
            await fn();
            return;
        } catch (err) {
            throw err;
        }
    };
};

var mochaAsyncBeforeHook = (fn) => {
    return async () => {
        try {
            await fn();
            return;
        } catch (err) {
            return;
        }
    };
};

var Web3 = require('web3');
var AbstractENSRegistrar = artifacts.require("./MockENSRegistrar.sol");
var AbstractDeed = artifacts.require("./MockDeed.sol");
var ListingRegistry = artifacts.require("./ListingRegistry.sol");
var ListingDB = artifacts.require("./ListingDB.sol");
var ListingService = artifacts.require("./ListingService.sol");
var EscrowService = artifacts.require("./EscrowService.sol");

var BidStatusEnum = Object.freeze({ "blank": 0, "bid": 1, "accepted": 2, "declined": 3, "escrowed": 4 });
var EscrowStatusEnum = Object.freeze({ "blank": 0, "started": 1, "domainTransferred": 2, "escrowRejected": 3, "settled": 4, "escrowWithdrawn": 5, "escrowScavenged": 6 });

var listingRegistry;
var listingService;
var listingDB;
var ensRegistrar;
var escrowService;

var REGISTRY_VERSION = 2;
var LISTING_DB_VERSION = 2;
var LISTING_SERVICE_VERSION = 2;
var ESCROW_SERVICE_VERSION = 2;
var NEXT_LISTING_ID = 1;
var NEXT_BID_ID = 1;
var NEXT_ESCROW_ID = 1;
var TIP_AMT = web3.toWei(0.005, "ether");
var ESCROW_DEFAULT_AMT = web3.toWei(1, "ether");
var GAS_COST_ESTIMATE_ETH = 0.1;
var ESCROW_AMT_MINUS_COSTS = web3.toWei(0.8, "ether");
var OFFER_LENGTH = 1000 * 2; // 2 seconds // 1000 * 60 * 60 * 24 * 7 // 7 days
var SCAVENGE_LENGTH = 1000 * 0.001; // 1 milli-second // 1000 * 60 * 60 * 24 * 30 // 30 days
var SLOWDOWN_FOR_EVENTSCANNER_TO_CATCHUP = 0; // 1000;

var account0 = web3.eth.accounts[0];
var account1 = web3.eth.accounts[1];
var account2 = web3.eth.accounts[2];

function isTestnet() {
    return web3.version.network == 3;
}

function isLive() {
    return web3.version.network == 1;
}

function isTestrpc() {
    return web3.version.network > 3;
}

console.log(web3.version.network);

if (web3.version.network == 3) {
    console.log("unlocking accounts for network " + web3.version.network);
    web3.personal.unlockAccount(web3.eth.accounts[0], "test", 3600)
    web3.personal.unlockAccount(web3.eth.accounts[1], "test", 3600)
    web3.personal.unlockAccount(web3.eth.accounts[2], "test", 3600)
    console.log("accounts unlocked");
} else {
    console.log("skipping account unlocks for network " + web3.version.network);
}

function namehash(name) {
    //console.log("---------------- namehash called for ", name, " ---------------\n");
    var node = '0x0000000000000000000000000000000000000000000000000000000000000000';
    if (name != '') {
        var labels = name.split(".");
        //console.log(labels, " node: " + node + "\n");
        for (var i = labels.length - 1; i >= 0; i--) {
            //console.log(" node: ", node, "label: ", labels[i], " slice:", web3.sha3(labels[i]).slice(2),'\n');
            //console.log("whole thing: ", node + web3.sha3(labels[i]).slice(2));
            node = web3.sha3(node + web3.sha3(labels[i]).slice(2), { encoding: 'hex' });
            //console.log('new node: ', node, '\n');
        }
    }
    //console.log("---------------- " + node + '\n');

    return node.toString();
}

function delay(t) {
    return new Promise(function (resolve) {
        setTimeout(resolve, t)
    });
}

async function register(ensNaked, account) {
    try {
        await ensRegistrar.register(web3.sha3(ensNaked), { from: account });
        return;
    } catch (err) {
        console.log('Duplicate ens name ' + ensNaked);
        throw 'Duplicate ens name ' + ensNaked;
    }
}

async function getDeedInfo(ensNaked) {
    var entries = await ensRegistrar.entries(web3.sha3(ensNaked));
    var deedAddr = entries[1];
    var deed = await AbstractDeed.at(deedAddr);
    var owner = await deed.owner();
    var previousOwner = await deed.previousOwner();
    return { owner: owner, previousOwner: previousOwner };
}

async function owner(ensNaked) {
    var deedInfo = await getDeedInfo(ensNaked);
    return deedInfo.owner;
}

async function createListing(ensNaked, account) {
    var index = await listingDB.index();
    var listingId = index[0];
    await listingService.addListing(ensNaked, "test@gmail.com", web3.toWei(1, "wei"), { from: account, value: web3.toWei(TIP_AMT, "wei") });
    var index = await listingDB.index();
    var nextListingId = index[0];
    return { nextListingId: nextListingId, listingId: listingId };
}

async function getBidInfo(bidId) {
    var bidInfo = await listingDB.getBidInfo(bidId);
    return { name: bidInfo[0], bidId: bidId, bidStatus: bidInfo[1], bidder: bidInfo[2], bidAmount: bidInfo[3] };
}

async function getEscrowAdminInfo() {
    var adminInfo = await escrowService.getAdminInfo();
    return {
        ensRegistrar: adminInfo[0], owner: adminInfo[1], registry: adminInfo[2], offerLength: adminInfo[3], scavengeLength: adminInfo[4],
        listingDB: adminInfo[5], tipsBalance: web3.toBigNumber(adminInfo[6]), nextEscrowId: adminInfo[7], abandoned: adminInfo[8]
    };
}

async function escrowTipsBalance() {
    var adminInfo = await getEscrowAdminInfo();
    return adminInfo.tipsBalance;
}

async function createBid(ensNaked, bidAmount, account) {
    var index = await listingDB.index();
    var bidId = index[1];
    await listingService.bid(ensNaked, "bidder1@gmail.com", bidAmount, { from: account });
    return await getBidInfo(bidId);
}

async function acceptBid(ensNaked, bidId, account) {
    await delay(SLOWDOWN_FOR_EVENTSCANNER_TO_CATCHUP);
    await listingService.acceptBid(ensNaked, bidId, { from: account });
    return await getBidInfo(bidId);
}

async function createEscrow(ensNaked, bidId, amount, account) {
    return await createEscrowWithTip(ensNaked, bidId, amount, account, 0);
}

async function createEscrowWithTip(ensNaked, bidId, amount, account, tipAmount) {
    var escrowId = await escrowService.nextEscrowId();
    await escrowService.startEscrow(ensNaked, amount, bidId, { from: account, value: web3.toBigNumber(amount).plus(tipAmount) });
    var escrowInfo = await getEscrowInfo(escrowId);
    return escrowInfo;
}

async function transferDomainToBuyer(ensNaked, escrowId, fromAccount) {
    return await transferDomainToBuyerWithTip(ensNaked, escrowId, fromAccount, 0);
}

async function transferDomainToBuyerWithTip(ensNaked, escrowId, fromAccount, tipAmount) {
    await delay(SLOWDOWN_FOR_EVENTSCANNER_TO_CATCHUP);
    await escrowService.transferDomainToBuyer(escrowId, { from: fromAccount, value: tipAmount });
    var escrowInfo = await getEscrowInfo(escrowId);
    var deedInfo = await getDeedInfo(ensNaked);
    return { escrowInfo: escrowInfo, deedInfo: deedInfo };
}

async function transferDomainToENSListing(ensNaked, fromAccount) {
    var deed = await getDeedInfo(ensNaked);
    await ensRegistrar.transfer(web3.sha3(ensNaked), escrowService.address, { from: fromAccount });
}

async function transferDomainBackToSeller(ensNaked, account) {
    return await transferDomainBackToSellerWithTip(ensNaked, account, 0);
}

async function transferDomainBackToSellerWithTip(ensNaked, account, tipAmount) {
    await delay(SLOWDOWN_FOR_EVENTSCANNER_TO_CATCHUP);
    await escrowService.transferDomainBackToSeller(ensNaked, { from: account, value: tipAmount });
    return;
}

async function drawFundsAfterTransfer(ensNaked, escrowId, account) {
    return await drawFundsAfterTransferWithTip(ensNaked, escrowId, account, 0);
}

async function drawFundsAfterTransferWithTip(ensNaked, escrowId, account, tipAmount) {
    await delay(SLOWDOWN_FOR_EVENTSCANNER_TO_CATCHUP);
    await escrowService.drawFundsAfterTransfer(escrowId, { from: account, value: tipAmount });
    var escrowInfo = await getEscrowInfo(escrowId);
    var deedInfo = await getDeedInfo(ensNaked);
    return { escrowInfo: escrowInfo, deedInfo: deedInfo };
}

async function rejectEscrow(ensNaked, escrowId, reason, account) {
    return await rejectEscrowWithTip(ensNaked, escrowId, reason, account, 0);
}

async function rejectEscrowWithTip(ensNaked, escrowId, reason, account, tipAmount) {
    await delay(SLOWDOWN_FOR_EVENTSCANNER_TO_CATCHUP);
    await escrowService.reject(escrowId, reason, { from: account, value: tipAmount });
    var escrowInfo = await getEscrowInfo(escrowId);
    var deedInfo = await getDeedInfo(ensNaked);
    return { escrowInfo: escrowInfo, deedInfo: deedInfo };
}

async function withdrawEscrow(ensNaked, escrowId, account) {
    return await withdrawEscrowWithTip(ensNaked, escrowId, account, 0);
}

async function withdrawEscrowWithTip(ensNaked, escrowId, account, tipAmount) {
    await delay(SLOWDOWN_FOR_EVENTSCANNER_TO_CATCHUP);
    await escrowService.withdrawEscrow(escrowId, { from: account, value: tipAmount });
    var escrowInfo = await getEscrowInfo(escrowId);
    var deedInfo = await getDeedInfo(ensNaked);
    return { escrowInfo: escrowInfo, deedInfo: deedInfo };
}

async function scavengeEscrow(ensNaked, escrowId, account) {
    await delay(SLOWDOWN_FOR_EVENTSCANNER_TO_CATCHUP);
    await escrowService.scavengeEscrow(escrowId, { from: account });
    var escrowInfo = await getEscrowInfo(escrowId);
    var deedInfo = await getDeedInfo(ensNaked);
    return { escrowInfo: escrowInfo, deedInfo: deedInfo };
}

function getBalances(buyerAccount, sellerAccount) {
    var balances = {};
    balances[buyerAccount] = web3.toBigNumber(web3.eth.getBalance(buyerAccount));
    balances[sellerAccount] = web3.toBigNumber(web3.eth.getBalance(sellerAccount));
    balances[escrowService.address] = web3.toBigNumber(web3.eth.getBalance(escrowService.address));
    return balances;
}


function increase(oldBalance, newBalance, account) {
    return newBalance[account].minus(oldBalance[account]).dividedBy('1000000000000000000').toNumber();
}

function drop(oldBalance, newBalance, account) {
    return -increase(oldBalance, newBalance, account);
}

async function getEscrowInfo(escrowId) {
    var escrowRawInfo = await escrowService.escrowDeed(escrowId);
    var nextEscrowId = await escrowService.nextEscrowId();
    return { escrowId: escrowId, bidder: escrowRawInfo[1], origOwner: escrowRawInfo[2], paymentAmount: escrowRawInfo[3], goodUntil: escrowRawInfo[4], escrowStatus: escrowRawInfo[5].valueOf(), nextEscrowId: nextEscrowId };
}

async function getNextEscrowId() {
    return await escrowService.nextEscrowId();
}

before(function () {
    this.timeout(0);
    var fn = mochaAsyncBeforeHook(async () => {
        if (isTestnet()) {
			//Update with your addresses for testnet.
            ensRegistrar = await AbstractENSRegistrar.at("0xAddressHere");
            listingRegistry = await ListingRegistry.at("0xAddressHere");
            listingDB = await ListingDB.at("0xAddressHere");
            escrowService = await EscrowService.at("0xAddressHere");
            listingService = await ListingService.at("0xAddressHere");
        } else if(isLive()) {
            ensRegistrar = await AbstractENSRegistrar.at("0x6090A6e47849629b7245Dfa1Ca21D94cd15878Ef");
            listingRegistry = await ListingRegistry.at("0xea2dA09172815869816940e7F21e7f960F8ce714");
            listingDB = await ListingDB.at("0x6421a5DE0385E184EcC7200830246957cb3C5B90");
            escrowService = await EscrowService.at("0x9fB0F6bf41119667e14AB0f9cD0973A674f12354");
            listingService = await ListingService.at("0xDdB8C99DDde24195C6155463a1bc7ca95E42c883");
		}
        else {
			//Deploy for testrpc or other local node
            ensRegistrar = await AbstractENSRegistrar.new();
            listingRegistry = await ListingRegistry.new(REGISTRY_VERSION, LISTING_DB_VERSION, LISTING_SERVICE_VERSION, ESCROW_SERVICE_VERSION);
            listingDB = await ListingDB.new(NEXT_LISTING_ID, NEXT_BID_ID, listingRegistry.address);
            await listingRegistry.assignListingDB(listingDB.address);
            escrowService = await EscrowService.new(ensRegistrar.address, listingRegistry.address, listingDB.address, OFFER_LENGTH/1000, SCAVENGE_LENGTH/1000, NEXT_ESCROW_ID);
            listingService = await ListingService.new(ensRegistrar.address, listingRegistry.address, listingDB.address);
            await listingRegistry.authorizeListingService(listingService.address);
            await listingRegistry.authorizeEscrowService(escrowService.address);
        }
        console.log("ENS Registrar loaded from: " + ensRegistrar.address);
        console.log("Registry loaded from: " + listingRegistry.address);
        console.log("Listing DB loaded from: " + listingDB.address);
        console.log("EscrowService loaded from: " + escrowService.address);
        console.log("ListingService loaded from: " + listingService.address);
        //Uncomment to see more info
        //console.log("listingRegistry state: " + await listingRegistry.admin.call());
        //console.log("listingDB state: " + await listingDB.admin.call());
        //console.log("listingService state: " + await listingService.admin.call());
    });
    return fn();
});

// Legend
// e = escrow
// e(b)= escrow with reference to bid id
// te = transfer domain to ENSListing EscrowService
// tb = transfer domain to buyer
// to = transfer domain back to owner
// d  = seller draw funds after transfer
// r  = seller reject escrow
// w  = buyer withdraw escrow payment
// <exp> = expiry of escrow contract after the goodUntil date
// <scv> = expiry of 30 day period after the contract expiry
// s     = scavenging of escrow to reclaim the funds
contract('EscrowService Happy Path',
    function () {
        it('should be able to e, te, tb, d',
            mochaAsync(async () => {
                var ensNaked = "e, te, tb, d";
                await register(ensNaked, account0);
                var escrowInfo = await createEscrow(ensNaked, 0, ESCROW_DEFAULT_AMT, account1);
                await transferDomainToENSListing(ensNaked, account0);
                await transferDomainToBuyer(ensNaked, escrowInfo.escrowId, account0);
                var result = await drawFundsAfterTransfer(ensNaked, escrowInfo.escrowId, account0);
            }));
        it('should be able to te, e, tb, d',
            mochaAsync(async () => {
                var ensNaked = "te, e, tb, d";
                await register(ensNaked, account0);
                await transferDomainToENSListing(ensNaked, account0);
                var escrowInfo = await createEscrow(ensNaked, 0, ESCROW_DEFAULT_AMT, account1);
                await transferDomainToBuyer(ensNaked, escrowInfo.escrowId, account0);
                var result = await drawFundsAfterTransfer(ensNaked, escrowInfo.escrowId, account0);
            }));
        it('should be able to e, e, te, tb, d',
            mochaAsync(async () => {
                var ensNaked = "e, e, te, tb, d";
                await register(ensNaked, account0);
                var escrowInfo = await createEscrow(ensNaked, 0, ESCROW_DEFAULT_AMT, account1);
                var escrowInfoAnother = await createEscrow(ensNaked, 0, ESCROW_DEFAULT_AMT, account2);
                await transferDomainToENSListing(ensNaked, account0);
                await transferDomainToBuyer(ensNaked, escrowInfo.escrowId, account0);
                var result = await drawFundsAfterTransfer(ensNaked, escrowInfo.escrowId, account0);
            }));
        it('should be able to e(b), te, tb, d',
            mochaAsync(async () => {
                var ensNaked = "e(b), te, tb, d";
                await register(ensNaked, account0);
                var listingIds = await createListing(ensNaked, account0);
                var bidInfo = await createBid(ensNaked, ESCROW_DEFAULT_AMT, account1);
                bidInfo = await acceptBid(ensNaked, bidInfo.bidId, account0);
                var escrowInfo = await createEscrow(ensNaked, bidInfo.bidId, ESCROW_DEFAULT_AMT, account1);
                await transferDomainToENSListing(ensNaked, account0);
                await transferDomainToBuyer(ensNaked, escrowInfo.escrowId, account0);
                var result = await drawFundsAfterTransfer(ensNaked, escrowInfo.escrowId, account0);
            }));
        it('should be able to e, r, w',
            mochaAsync(async () => {
                var ensNaked = "e, r, w";
                await register(ensNaked, account0);
                var escrowInfo = await createEscrow(ensNaked, 0, ESCROW_DEFAULT_AMT, account1);
                await rejectEscrow(ensNaked, escrowInfo.escrowId, 'no reason', account0);
                var result = await withdrawEscrow(ensNaked, escrowInfo.escrowId, account1);
            }));
        it('should be able to e, te, to',
            mochaAsync(async () => {
                var ensNaked = "e, te, to";
                await register(ensNaked, account0);
                var listingIds = await createListing(ensNaked, account0);
                var bidInfo = await createBid(ensNaked, ESCROW_DEFAULT_AMT, account1);
                bidInfo = await acceptBid(ensNaked, bidInfo.bidId, account0);
                var escrowInfo = await createEscrow(ensNaked, bidInfo.bidId, ESCROW_DEFAULT_AMT, account1);
                await transferDomainToENSListing(ensNaked, account0);
                var result = await transferDomainBackToSeller(ensNaked, account0);
            }));
        it('should be able to e, <exp>, w',
            mochaAsync(async () => {
                var ensNaked = "e, <exp>, w";
                await register(ensNaked, account0);
                var escrowInfo = await createEscrow(ensNaked, 0, ESCROW_DEFAULT_AMT, account1);
                await delay(OFFER_LENGTH + 2000);
                escrowInfo = await getEscrowInfo(escrowInfo.escrowId);
                var result = await withdrawEscrow(ensNaked, escrowInfo.escrowId, account1);
            }));
        it('should be able to e, <exp>,<scv>, s',
            mochaAsync(async () => {
                var ensNaked = "e, <exp>,<scv>, s";
                await register(ensNaked, account0);
                var escrowInfo = await createEscrow(ensNaked, 0, ESCROW_DEFAULT_AMT, account1);
                await delay(OFFER_LENGTH + SCAVENGE_LENGTH + 1000);
                var result = await scavengeEscrow(ensNaked, escrowInfo.escrowId, account1);
            }));
    });

contract('EscrowService Banned Flows',
    function () {
        it('dont allow e,w',
            mochaAsync(async () => {
                var ensNaked = "e,w";
                await register(ensNaked, account0);
                var escrowInfo = await createEscrow(ensNaked, 0, ESCROW_DEFAULT_AMT, account1);
                try {
                    var result = await withdrawEscrow(ensNaked, escrowInfo.escrowId, account1);
                    assert.fail("no error", "error", "Invalid opcode not raised");
                } catch (err) {
                    assert.include(err.message, 'invalid opcode', "Error code different, expected invalid opcode, got " + err.message);
                    return;
                }
                try {

                    assert.fail("no error", "error", "Invalid opcode not raised");
                } catch (err) {
                    assert.include(err.message, 'invalid opcode', "Error code different, expected invalid opcode, got " + err.message);
                    return;
                }
            }));
        it('dont allow e, d',
            mochaAsync(async () => {
                var ensNaked = "e, d";
                await register(ensNaked, account0);
                var escrowInfo = await createEscrow(ensNaked, 0, ESCROW_DEFAULT_AMT, account1);
                try {
                    var result = await drawFundsAfterTransfer(ensNaked, escrowInfo.escrowId, account0);
                    assert.fail("no error", "error", "Invalid opcode not raised");
                } catch (err) {
                    assert.include(err.message, 'invalid opcode', "Error code different, expected invalid opcode, got " + err.message);
                    return;
                }
            }));
        it('dont allow e, te, d',
            mochaAsync(async () => {
                var ensNaked = "e, te, d";
                await register(ensNaked, account0);
                var escrowInfo = await createEscrow(ensNaked, 0, ESCROW_DEFAULT_AMT, account1);
                await transferDomainToENSListing(ensNaked, account0);
                try {
                    var result = await drawFundsAfterTransfer(ensNaked, escrowInfo.escrowId, account0);
                    assert.fail("no error", "error", "Invalid opcode not raised");
                } catch (err) {
                    assert.include(err.message, 'invalid opcode', "Error code different, expected invalid opcode, got " + err.message);
                    return;
                }
            }));
        it('dont allow e, tb',
            mochaAsync(async () => {
                var ensNaked = "e, tb";
                await register(ensNaked, account0);
                var escrowInfo = await createEscrow(ensNaked, 0, ESCROW_DEFAULT_AMT, account1);
                try {
                    await transferDomainToBuyer(ensNaked, escrowInfo.escrowId, account0);
                    assert.fail("no error", "error", "Invalid opcode not raised");
                } catch (err) {
                    assert.include(err.message, 'invalid opcode', "Error code different, expected invalid opcode, got " + err.message);
                    return;
                }
            }));
        it('dont allow e, r, tb',
            mochaAsync(async () => {
                var ensNaked = "e,r, tb";
                await register(ensNaked, account0);
                var escrowInfo = await createEscrow(ensNaked, 0, ESCROW_DEFAULT_AMT, account1);
                await rejectEscrow(ensNaked, escrowInfo.escrowId, 'no reason', account0);
                try {
                    await transferDomainToBuyer(ensNaked, escrowInfo.escrowId, account0);
                    assert.fail("no error", "error", "Invalid opcode not raised");
                } catch (err) {
                    assert.include(err.message, 'invalid opcode', "Error code different, expected invalid opcode, got " + err.message);
                    return;
                }
            }));
        it('dont allow e, r, te, tb',
            mochaAsync(async () => {
                var ensNaked = "e,r,te, tb";
                await register(ensNaked, account0);
                var escrowInfo = await createEscrow(ensNaked, 0, ESCROW_DEFAULT_AMT, account1);
                await rejectEscrow(ensNaked, escrowInfo.escrowId, 'no reason', account0);
                await transferDomainToENSListing(ensNaked, account0);
                try {
                    await transferDomainToBuyer(ensNaked, escrowInfo.escrowId, account0);
                    assert.fail("no error", "error", "Invalid opcode not raised");
                } catch (err) {
                    assert.include(err.message, 'invalid opcode', "Error code different, expected invalid opcode, got " + err.message);
                    return;
                }
            }));
        it('dont allow e, <exp>, tb',
            mochaAsync(async () => {
                var ensNaked = "e,<exp>, tb";
                await register(ensNaked, account0);
                var escrowInfo = await createEscrow(ensNaked, 0, ESCROW_DEFAULT_AMT, account1);
                await delay(OFFER_LENGTH + 1000);
                try {
                    await transferDomainToBuyer(ensNaked, escrowInfo.escrowId, account0);
                    assert.fail("no error", "error", "Invalid opcode not raised");
                } catch (err) {
                    assert.include(err.message, 'invalid opcode', "Error code different, expected invalid opcode, got " + err.message);
                    return;
                }
            }));
        it('dont allow e, te, <exp>, tb',
            mochaAsync(async () => {
                var ensNaked = "e,te, <exp>, tb";
                await register(ensNaked, account0);
                var escrowInfo = await createEscrow(ensNaked, 0, ESCROW_DEFAULT_AMT, account1);
                await transferDomainToENSListing(ensNaked, account0);
                await delay(OFFER_LENGTH + 1000);
                try {
                    await transferDomainToBuyer(ensNaked, escrowInfo.escrowId, account0);
                    assert.fail("no error", "error", "Invalid opcode not raised");
                } catch (err) {
                    assert.include(err.message, 'invalid opcode', "Error code different, expected invalid opcode, got " + err.message);
                    return;
                }
            }));
        it('dont allow e, <exp>, te, tb',
            mochaAsync(async () => {
                var ensNaked = "e,<exp>,te, tb";
                await register(ensNaked, account0);
                var escrowInfo = await createEscrow(ensNaked, 0, ESCROW_DEFAULT_AMT, account1);
                await delay(OFFER_LENGTH + 1000);
                await transferDomainToENSListing(ensNaked, account0);
                try {
                    await transferDomainToBuyer(ensNaked, escrowInfo.escrowId, account0);
                    assert.fail("no error", "error", "Invalid opcode not raised");
                } catch (err) {
                    assert.include(err.message, 'invalid opcode', "Error code different, expected invalid opcode, got " + err.message);
                    return;
                }
            }));
        it('dont allow e, <exp>, w, w',
            mochaAsync(async () => {
                var ensNaked = "e, <exp>, w,w";
                await register(ensNaked, account0);
                var escrowInfo = await createEscrow(ensNaked, 0, ESCROW_DEFAULT_AMT, account1);
                await delay(OFFER_LENGTH + 2000);
                escrowInfo = await getEscrowInfo(escrowInfo.escrowId);
                var result = await withdrawEscrow(ensNaked, escrowInfo.escrowId, account1);
                try {
                    await withdrawEscrow(ensNaked, escrowInfo.escrowId, account1);
                    assert.fail("no error", "error", "Invalid opcode not raised");
                } catch (err) {
                    assert.include(err.message, 'invalid opcode', "Error code different, expected invalid opcode, got " + err.message);
                    return;
                }
            }));
        it('dont allow e, r, w, w',
            mochaAsync(async () => {
                var ensNaked = "e, r, w";
                await register(ensNaked, account0);
                var escrowInfo = await createEscrow(ensNaked, 0, ESCROW_DEFAULT_AMT, account1);
                await rejectEscrow(ensNaked, escrowInfo.escrowId, 'no reason', account0);
                var result = await withdrawEscrow(ensNaked, escrowInfo.escrowId, account1);
                try {
                    await withdrawEscrow(ensNaked, escrowInfo.escrowId, account1);
                    assert.fail("no error", "error", "Invalid opcode not raised");
                } catch (err) {
                    assert.include(err.message, 'invalid opcode', "Error code different, expected invalid opcode, got " + err.message);
                    return;
                }
            }));
        it('dont allow e(b), te, tb, d, d',
            mochaAsync(async () => {
                var ensNaked = "e(b), te, tb, d, d";
                await register(ensNaked, account0);
                var listingIds = await createListing(ensNaked, account0);
                var bidInfo = await createBid(ensNaked, ESCROW_DEFAULT_AMT, account1);
                bidInfo = await acceptBid(ensNaked, bidInfo.bidId, account0);
                var escrowInfo = await createEscrow(ensNaked, bidInfo.bidId, ESCROW_DEFAULT_AMT, account1);
                await transferDomainToENSListing(ensNaked, account0);
                await transferDomainToBuyer(ensNaked, escrowInfo.escrowId, account0);
                var result = await drawFundsAfterTransfer(ensNaked, escrowInfo.escrowId, account0);
                try {
                    await drawFundsAfterTransfer(ensNaked, escrowInfo.escrowId, account0);
                    assert.fail("no error", "error", "Invalid opcode not raised");
                } catch (err) {
                    assert.include(err.message, 'invalid opcode', "Error code different, expected invalid opcode, got " + err.message);
                    return;
                }
            }));
        it('dont allow e(b), te, tb, d, <exp>, w',
            mochaAsync(async () => {
                var ensNaked = "e(b), te, tb, d, <exp>, w";
                await register(ensNaked, account0);
                var listingIds = await createListing(ensNaked, account0);
                var bidInfo = await createBid(ensNaked, ESCROW_DEFAULT_AMT, account1);
                bidInfo = await acceptBid(ensNaked, bidInfo.bidId, account0);
                var escrowInfo = await createEscrow(ensNaked, bidInfo.bidId, ESCROW_DEFAULT_AMT, account1);
                await transferDomainToENSListing(ensNaked, account0);
                await transferDomainToBuyer(ensNaked, escrowInfo.escrowId, account0);
                var result = await drawFundsAfterTransfer(ensNaked, escrowInfo.escrowId, account0);
                await delay(OFFER_LENGTH + 1000);
                try {
                    await withdrawEscrow(ensNaked, escrowInfo.escrowId, account1);
                    assert.fail("no error", "error", "Invalid opcode not raised");
                } catch (err) {
                    assert.include(err.message, 'invalid opcode', "Error code different, expected invalid opcode, got " + err.message);
                    return;
                }
            }));
        it('dont allow e, <exp>, <scv>, s, w',
            mochaAsync(async () => {
                var ensNaked = "e, <exp>,<scv>, s, w";
                await register(ensNaked, account0);
                var escrowInfo = await createEscrow(ensNaked, 0, ESCROW_DEFAULT_AMT, account1);
                await delay(OFFER_LENGTH + SCAVENGE_LENGTH + 1000);
                var result = await scavengeEscrow(ensNaked, escrowInfo.escrowId, account1);
                try {
                    await withdrawEscrow(ensNaked, escrowInfo.escrowId, account1);
                    assert.fail("no error", "error", "Invalid opcode not raised");
                } catch (err) {
                    assert.include(err.message, 'invalid opcode', "Error code different, expected invalid opcode, got " + err.message);
                    return;
                }
            }));
        it('dont allow e, <exp>, <scv>, s, te, tb',
            mochaAsync(async () => {
                var ensNaked = "e, <exp>,<scv>, s, te, tb";
                await register(ensNaked, account0);
                var escrowInfo = await createEscrow(ensNaked, 0, ESCROW_DEFAULT_AMT, account1);
                await delay(OFFER_LENGTH + SCAVENGE_LENGTH + 1000);
                var result = await scavengeEscrow(ensNaked, escrowInfo.escrowId, account1);
                await transferDomainToENSListing(ensNaked, account0);
                try {
                    await transferDomainToBuyer(ensNaked, escrowInfo.escrowId, account0);
                    assert.fail("no error", "error", "Invalid opcode not raised");
                } catch (err) {
                    assert.include(err.message, 'invalid opcode', "Error code different, expected invalid opcode, got " + err.message);
                    return;
                }
            }));


        it('dont allow e(b), te, tb, to',
            mochaAsync(async () => {
                var ensNaked = "e(b), te, tb, to";
                await register(ensNaked, account0);
                var listingIds = await createListing(ensNaked, account0);
                var bidInfo = await createBid(ensNaked, ESCROW_DEFAULT_AMT, account1);
                bidInfo = await acceptBid(ensNaked, bidInfo.bidId, account0);
                var escrowInfo = await createEscrow(ensNaked, bidInfo.bidId, ESCROW_DEFAULT_AMT, account1);
                await transferDomainToENSListing(ensNaked, account0);
                await transferDomainToBuyer(ensNaked, escrowInfo.escrowId, account0);
                try {
                    var result = await transferDomainBackToSeller(ensNaked, account0);
                    assert.fail("no error", "error", "Invalid opcode not raised");
                } catch (err) {
                    assert.include(err.message, 'invalid opcode', "Error code different, expected invalid opcode, got " + err.message);
                    return;
                }
            }));
        it('dont allow e(b), te, tb, d, to',
            mochaAsync(async () => {
                var ensNaked = "e(b), te, tb, d, to";
                await register(ensNaked, account0);
                var listingIds = await createListing(ensNaked, account0);
                var bidInfo = await createBid(ensNaked, ESCROW_DEFAULT_AMT, account1);
                bidInfo = await acceptBid(ensNaked, bidInfo.bidId, account0);
                var escrowInfo = await createEscrow(ensNaked, bidInfo.bidId, ESCROW_DEFAULT_AMT, account1);
                await transferDomainToENSListing(ensNaked, account0);
                await transferDomainToBuyer(ensNaked, escrowInfo.escrowId, account0);
                var result = await drawFundsAfterTransfer(ensNaked, escrowInfo.escrowId, account0);
                try {
                    var result = await transferDomainBackToSeller(ensNaked, account0);
                    assert.fail("no error", "error", "Invalid opcode not raised");
                } catch (err) {
                    assert.include(err.message, 'invalid opcode', "Error code different, expected invalid opcode, got " + err.message);
                    return;
                }
            }));
        it('dont allow e(b), te, to, tb',
            mochaAsync(async () => {
                var ensNaked = "e(b), te, to, tb";
                await register(ensNaked, account0);
                var listingIds = await createListing(ensNaked, account0);
                var bidInfo = await createBid(ensNaked, ESCROW_DEFAULT_AMT, account1);
                bidInfo = await acceptBid(ensNaked, bidInfo.bidId, account0);
                var escrowInfo = await createEscrow(ensNaked, bidInfo.bidId, ESCROW_DEFAULT_AMT, account1);
                await transferDomainToENSListing(ensNaked, account0);
                var result = await transferDomainBackToSeller(ensNaked, account0);
                try {
                    await transferDomainToBuyer(ensNaked, escrowInfo.escrowId, account0);
                    assert.fail("no error", "error", "Invalid opcode not raised");
                } catch (err) {
                    assert.include(err.message, 'invalid opcode', "Error code different, expected invalid opcode, got " + err.message);
                    return;
                }
            }));
        it('dont allow e, e, te, tb, tb',
            mochaAsync(async () => {
                var ensNaked = "e, e, te, tb, tb";
                await register(ensNaked, account0);
                var escrowInfo1 = await createEscrow(ensNaked, 0, ESCROW_DEFAULT_AMT, account2);
                var escrowInfo = await createEscrow(ensNaked, 0, ESCROW_DEFAULT_AMT, account1);
                await transferDomainToENSListing(ensNaked, account0);
                await transferDomainToBuyer(ensNaked, escrowInfo.escrowId, account0);
                try {
                    await transferDomainToBuyer(ensNaked, escrowInfo1.escrowId, account0);
                    assert.fail("no error", "error", "Invalid opcode not raised");
                } catch (err) {
                    assert.include(err.message, 'invalid opcode', "Error code different, expected invalid opcode, got " + err.message);
                    return;
                }
            }));
        it('dont allow e, e, te, tb, d, d',
            mochaAsync(async () => {
                var ensNaked = "e, e, te, tb, d, d";
                await register(ensNaked, account0);
                var escrowInfo1 = await createEscrow(ensNaked, 0, ESCROW_DEFAULT_AMT, account2);
                var escrowInfo = await createEscrow(ensNaked, 0, ESCROW_DEFAULT_AMT, account1);
                await transferDomainToENSListing(ensNaked, account0);
                await transferDomainToBuyer(ensNaked, escrowInfo.escrowId, account0);
                var result = await drawFundsAfterTransfer(ensNaked, escrowInfo.escrowId, account0);
                try {
                    var result = await drawFundsAfterTransfer(ensNaked, escrowInfo1.escrowId, account0);
                    assert.fail("no error", "error", "Invalid opcode not raised");
                } catch (err) {
                    assert.include(err.message, 'invalid opcode', "Error code different, expected invalid opcode, got " + err.message);
                    return;
                }
            }));


    });

contract('EscrowService Status Tracking ',
    function () {
        it('should set status to started when escrow starts',
            mochaAsync(async () => {
                var ensNaked = "status-started";
                await register(ensNaked, account0);
                var escrowInfo = await createEscrow(ensNaked, 0, ESCROW_DEFAULT_AMT, account0);
                assert.equal(escrowInfo.escrowStatus, EscrowStatusEnum.started, "escrow status not set to started");
            }));
        it('should set status to domainTransferred after transfer',
            mochaAsync(async () => {
                var ensNaked = "status-domainTransferred";
                await register(ensNaked, account0);
                var escrowInfo = await createEscrow(ensNaked, 0, ESCROW_DEFAULT_AMT, account1);
                await transferDomainToENSListing(ensNaked, account0);
                var result = await transferDomainToBuyer(ensNaked, escrowInfo.escrowId, account0);
                assert.equal(result.escrowInfo.escrowStatus, EscrowStatusEnum.domainTransferred, "escrow status not set to domainTransferred");
            }));
        it('should set status to settled after transfer and draw funds',
            mochaAsync(async () => {
                var ensNaked = "status-settled";
                await register(ensNaked, account0);
                var escrowInfo = await createEscrow(ensNaked, 0, ESCROW_DEFAULT_AMT, account1);
                await transferDomainToENSListing(ensNaked, account0);
                await transferDomainToBuyer(ensNaked, escrowInfo.escrowId, account0);
                var result = await drawFundsAfterTransfer(ensNaked, escrowInfo.escrowId, account0);
                assert.equal(result.escrowInfo.escrowStatus.valueOf(), EscrowStatusEnum.settled, "escrow status not set to settled");
            }));
        it('escrow should stay as-is if seller xfers domain back',
            mochaAsync(async () => {
                var ensNaked = "status-xferback";
                await register(ensNaked, account0);
                var escrowInfoBefore = await createEscrow(ensNaked, 0, ESCROW_DEFAULT_AMT, account1);
                await transferDomainToENSListing(ensNaked, account0);
                var result = await transferDomainBackToSeller(ensNaked, account0);
                var escrowInfoAfter = await getEscrowInfo(escrowInfoBefore.escrowId);
                assert.equal(escrowInfoBefore.escrowStatus, escrowInfoAfter.escrowStatus, "escrow status affected");
            }));
        it('should set status to rejected after rejection',
            mochaAsync(async () => {
                var ensNaked = "status-rejected";
                await register(ensNaked, account0);
                var escrowInfo = await createEscrow(ensNaked, 0, ESCROW_DEFAULT_AMT, account1);
                var result = await rejectEscrow(ensNaked, escrowInfo.escrowId, 'no reason', account0);
                assert.equal(result.escrowInfo.escrowStatus, EscrowStatusEnum.escrowRejected, "escrow status not set to escrowRejected");
            }));
        it('should set status to escrowWithdrawn after withdrawl',
            mochaAsync(async () => {
                var ensNaked = "status-withdrawl";
                await register(ensNaked, account0);
                var escrowInfo = await createEscrow(ensNaked, 0, ESCROW_DEFAULT_AMT, account1);
                await rejectEscrow(ensNaked, escrowInfo.escrowId, 'no reason', account0);
                var result = await withdrawEscrow(ensNaked, escrowInfo.escrowId, account1);
                assert.equal(result.escrowInfo.escrowStatus, EscrowStatusEnum.escrowWithdrawn, "escrow status not set to escrowWithdrawn");
            }));
        it('should be able to scavenge escrow in started status',
            mochaAsync(async () => {
                var ensNaked = "status-scavenged";
                await register(ensNaked, account0);
                var escrowInfo = await createEscrow(ensNaked, 0, ESCROW_DEFAULT_AMT, account1);
                //console.log(`escrow good until ${escrowInfo.goodUntil} now is ${new Date().valueOf()}`);
                await delay(OFFER_LENGTH + SCAVENGE_LENGTH+1000);
                escrowInfo = await getEscrowInfo(escrowInfo.escrowId);
                //console.log(`escrow good until ${escrowInfo.goodUntil} now is ${new Date().valueOf()}`);
                var result = await scavengeEscrow(ensNaked, escrowInfo.escrowId, account1);
                assert.equal(result.escrowInfo.escrowStatus, EscrowStatusEnum.escrowScavenged, "escrow status not set to escrowScavenged");
            }));
        it('should able to scavenge escrow after transfer before draw funds',
            mochaAsync(async () => {
                var ensNaked = "status-domainTransferred-scavenged";
                await register(ensNaked, account0);
                var escrowInfo = await createEscrow(ensNaked, 0, ESCROW_DEFAULT_AMT, account1);
                await transferDomainToENSListing(ensNaked, account0);
                var result = await transferDomainToBuyer(ensNaked, escrowInfo.escrowId, account0);
                assert.equal(result.escrowInfo.escrowStatus, EscrowStatusEnum.domainTransferred, "escrow status not set to domainTransferred");
                await delay(OFFER_LENGTH + SCAVENGE_LENGTH+1000);
                //console.log(`escrow good until ${escrowInfo.goodUntil} now is ${new Date().valueOf()}`);
                result = await scavengeEscrow(ensNaked, escrowInfo.escrowId, account1);
                assert.equal(result.escrowInfo.escrowStatus, EscrowStatusEnum.escrowScavenged, "escrow status not set to escrowScavenged");
            }));
        it('should be able to scavenge escrow after rejection',
            mochaAsync(async () => {
                var ensNaked = "status-rejected-scavenged";
                await register(ensNaked, account0);
                var escrowInfo = await createEscrow(ensNaked, 0, ESCROW_DEFAULT_AMT, account1);
                var result = await rejectEscrow(ensNaked, escrowInfo.escrowId, 'no reason', account0);
                await delay(OFFER_LENGTH + SCAVENGE_LENGTH+1000);
                //console.log(`escrow good until ${escrowInfo.goodUntil} now is ${new Date().valueOf()}`);
                result = await scavengeEscrow(ensNaked, escrowInfo.escrowId, account1);
                assert.equal(result.escrowInfo.escrowStatus, EscrowStatusEnum.escrowScavenged, "escrow status not set to escrowScavenged");
            }));
        it('should not be able to scavenge escrow after settled',
            mochaAsync(async () => {
                var ensNaked = "status-settled-scavenged";
                await register(ensNaked, account0);
                var escrowInfo = await createEscrow(ensNaked, 0, ESCROW_DEFAULT_AMT, account1);
                await transferDomainToENSListing(ensNaked, account0);
                await transferDomainToBuyer(ensNaked, escrowInfo.escrowId, account0);
                var result = await drawFundsAfterTransfer(ensNaked, escrowInfo.escrowId, account0);
                await delay(OFFER_LENGTH + SCAVENGE_LENGTH+1000);
                try {
                    result = await scavengeEscrow(ensNaked, escrowInfo.escrowId, account1);
                    assert.fail("no error", "error", "Invalid opcode not raised when scavenge escrow after settled");
                } catch (err) {
                    assert.include(err.message, 'invalid opcode', "Error code different when scavenge escrow after settled, expected invalid opcode, got " + err.message);
                    var escrowInfo = await getEscrowInfo(escrowInfo.escrowId);
                    assert.equal(escrowInfo.escrowStatus, EscrowStatusEnum.settled, "escrow status not in settled");
                    return;
                }
            }));
        it('should not be able to scavenge escrow after withdrawl',
            mochaAsync(async () => {
                var ensNaked = "status-withdrawl-scavenged";
                await register(ensNaked, account0);
                var escrowInfo = await createEscrow(ensNaked, 0, ESCROW_DEFAULT_AMT, account1);
                await rejectEscrow(ensNaked, escrowInfo.escrowId, 'no reason', account0);
                var result = await withdrawEscrow(ensNaked, escrowInfo.escrowId, account1);
                await delay(OFFER_LENGTH + SCAVENGE_LENGTH+1000);
                try {
                    result = await scavengeEscrow(ensNaked, escrowInfo.escrowId, account1);
                    assert.fail("no error", "error", "Invalid opcode not raised when scavenge escrow after withdrawl");
                } catch (err) {
                    assert.include(err.message, 'invalid opcode', "Error code different when scavenge escrow after withdrawl, expected invalid opcode, got " + err.message);
                    var escrowInfo = await getEscrowInfo(escrowInfo.escrowId);
                    assert.equal(escrowInfo.escrowStatus, EscrowStatusEnum.escrowWithdrawn, "escrow status not in escrowWithdrawn");
                    return;
                }
            }));
        it('should not be able to scavenge escrow in scavenged status',
            mochaAsync(async () => {
                var ensNaked = "status-scavenged-scavenged";
                await register(ensNaked, account0);
                var escrowInfo = await createEscrow(ensNaked, 0, ESCROW_DEFAULT_AMT, account1);
                //console.log(`escrow good until ${escrowInfo.goodUntil} now is ${new Date().valueOf()}`);
                await delay(OFFER_LENGTH + SCAVENGE_LENGTH+1000);
                escrowInfo = await getEscrowInfo(escrowInfo.escrowId);
                //console.log(`escrow good until ${escrowInfo.goodUntil} now is ${new Date().valueOf()}`);
                var result = await scavengeEscrow(ensNaked, escrowInfo.escrowId, account1);
                try {
                    result = await scavengeEscrow(ensNaked, escrowInfo.escrowId, account1);
                    assert.fail("no error", "error", "Invalid opcode not raised when scavenge escrow after scavenge");
                } catch (err) {
                    assert.include(err.message, 'invalid opcode', "Error code different when scavenge escrow after scavenge, expected invalid opcode, got " + err.message);
                    var escrowInfo = await getEscrowInfo(escrowInfo.escrowId);
                    assert.equal(escrowInfo.escrowStatus, EscrowStatusEnum.escrowScavenged, "escrow status not in scavenge");
                    return;
                }
            }));
    });

contract('EscrowService Ownership Tracking',
    function () {
        it('te => o=e',
            mochaAsync(async () => {
                var ensNaked = "te => o=e";
                await register(ensNaked, account0);
                await transferDomainToENSListing(ensNaked, account0);
                var deed = await getDeedInfo(ensNaked);
                assert.equal(deed.owner, escrowService.address, "o!=e");
            }));
        it('te, ts => o=s',
            mochaAsync(async () => {
                var ensNaked = "te, ts, o=s";
                await register(ensNaked, account0);
                await transferDomainToENSListing(ensNaked, account0);
                var result = await transferDomainBackToSeller(ensNaked, account0);
                var deed = await getDeedInfo(ensNaked);
                assert.equal(deed.owner, account0, "o!=s");
            }));
        //see abandoned flow for more examples
        it("e => o=s", mochaAsync(async () => {
            var ensNaked = "e, o=s";
            await register(ensNaked, account1);
            var escrowInfo = await createEscrow(ensNaked, 0, ESCROW_DEFAULT_AMT, account0);
            var deed = await getDeedInfo(ensNaked);
            assert.equal(deed.owner, account1, "o!=s");
        }));
        it("e, te => o=e", mochaAsync(async () => {
            var ensNaked = "e, te, o=e";
            await register(ensNaked, account1);
            await transferDomainToENSListing(ensNaked, account1);
            var escrowInfo = await createEscrow(ensNaked, 0, ESCROW_DEFAULT_AMT, account0);
            var deed = await getDeedInfo(ensNaked);
            assert.equal(deed.owner, escrowService.address, "o!=e");
        }));
        it("e, te,tb => o=b", mochaAsync(async () => {
            var ensNaked = "e, te,tb, o=b";
            await register(ensNaked, account1);
            await transferDomainToENSListing(ensNaked, account1);
            var escrowInfo = await createEscrow(ensNaked, 0, ESCROW_DEFAULT_AMT, account0);
            await transferDomainToBuyer(ensNaked, escrowInfo.escrowId, account1);
            var deed = await getDeedInfo(ensNaked);
            assert.equal(deed.owner, account0, "o!=b");
        }));
        it("e, te,r => o=e", mochaAsync(async () => {
            var ensNaked = "e, te,tb, o=e";
            await register(ensNaked, account1);
            var escrowInfo = await createEscrow(ensNaked, 0, ESCROW_DEFAULT_AMT, account0);
            await transferDomainToENSListing(ensNaked, account1);
            var result = await rejectEscrow(ensNaked, escrowInfo.escrowId, 'no reason', account1);
            var deed = await getDeedInfo(ensNaked);
            assert.equal(deed.owner, escrowService.address, "o!=e");
        }));
        it("e, te,ts => o=s", mochaAsync(async () => {
            var ensNaked = "e, te,ts, o=s";
            await register(ensNaked, account1);
            await transferDomainToENSListing(ensNaked, account1);
            var escrowInfo = await createEscrow(ensNaked, 0, ESCROW_DEFAULT_AMT, account0);
            await transferDomainBackToSeller(ensNaked, account1);
            var deed = await getDeedInfo(ensNaked);
            assert.equal(deed.owner, account1, "o!=s");
        }));
        it("e, te,r,ts => o=s", mochaAsync(async () => {
            var ensNaked = "e, te,r,ts, o=s";
            await register(ensNaked, account1);
            await transferDomainToENSListing(ensNaked, account1);
            var escrowInfo = await createEscrow(ensNaked, 0, ESCROW_DEFAULT_AMT, account0);
            var result = await rejectEscrow(ensNaked, escrowInfo.escrowId, 'no reason', account1);
            await transferDomainBackToSeller(ensNaked, account1);
            var deed = await getDeedInfo(ensNaked);
            assert.equal(deed.owner, account1, "o!=s");
        }));
        it("e, te, <exp> => o=e", mochaAsync(async () => {
            var ensNaked = "e, te, <exp>, o=e";
            await register(ensNaked, account1);
            await transferDomainToENSListing(ensNaked, account1);
            var escrowInfo = await createEscrow(ensNaked, 0, ESCROW_DEFAULT_AMT, account0);
            await delay(OFFER_LENGTH + 1000);
            var deed = await getDeedInfo(ensNaked);
            assert.equal(deed.owner, escrowService.address, "o!=e");
        }));
        it("e, te, <exp>, ts => o=s", mochaAsync(async () => {
            var ensNaked = "e, te, <exp>, ts, o=s";
            await register(ensNaked, account1);
            await transferDomainToENSListing(ensNaked, account1);
            var escrowInfo = await createEscrow(ensNaked, 0, ESCROW_DEFAULT_AMT, account0);
            await delay(OFFER_LENGTH + 1000);
            await transferDomainBackToSeller(ensNaked, account1);
            var deed = await getDeedInfo(ensNaked);
            assert.equal(deed.owner, account1, "o!=s");
        }));
        it("e, te, <exp>, <scv> => o=e", mochaAsync(async () => {
            var ensNaked = "e, te, <exp>, <scv>, o=e";
            await register(ensNaked, account1);
            await transferDomainToENSListing(ensNaked, account1);
            var escrowInfo = await createEscrow(ensNaked, 0, ESCROW_DEFAULT_AMT, account0);
            await delay(OFFER_LENGTH + SCAVENGE_LENGTH + 1000);
            var result = await scavengeEscrow(ensNaked, escrowInfo.escrowId, account1);
            var deed = await getDeedInfo(ensNaked);
            assert.equal(deed.owner, escrowService.address, "o!=s");
        }));
        it("e, te, <exp>, <scv>, ts => o=s", mochaAsync(async () => {
            var ensNaked = "e, te, <exp>, <scv>, ts, o=s";
            await register(ensNaked, account1);
            await transferDomainToENSListing(ensNaked, account1);
            var escrowInfo = await createEscrow(ensNaked, 0, ESCROW_DEFAULT_AMT, account0);
            await delay(OFFER_LENGTH + SCAVENGE_LENGTH + 1000);
            var result = await scavengeEscrow(ensNaked, escrowInfo.escrowId, account1);
            await transferDomainBackToSeller(ensNaked, account1);
            var deed = await getDeedInfo(ensNaked);
            assert.equal(deed.owner, account1, "o!=s");
        }));

    });


contract('EscrowService few end-to-end Flows', function () {
    it("Should be able to post escrow without any dependencies", mochaAsync(async () => {
        var ensNaked = "post-escrow-nodep";
        await register(ensNaked, account0);
        var escrowInfo = await createEscrow(ensNaked, 0, ESCROW_DEFAULT_AMT, account0);
        assert.isAbove(escrowInfo.nextEscrowId, escrowInfo.escrowId, "Escrow not created");
        assert.equal(escrowInfo.escrowStatus, EscrowStatusEnum.started, "escrow status not set to started");
    }));

    it("Should be able to post escrow for a listed domain", mochaAsync(async () => {
        var ensNaked = "post-escrow-domainlisted";
        await register(ensNaked, account0);
        var listingIds = await createListing(ensNaked, account0);
        var escrowInfo = await createEscrow(ensNaked, 0, ESCROW_DEFAULT_AMT, account1);
        assert.isAbove(escrowInfo.nextEscrowId, escrowInfo.escrowId, "Escrow not created");
        assert.equal(escrowInfo.escrowStatus, EscrowStatusEnum.started, "escrow status not set to started");
    }));

    it("Should be able to post escrow for a domain with accepted bid", mochaAsync(async () => {
        var ensNaked = "post-escrow-acceptedbid";
        await register(ensNaked, account0);
        var listingIds = await createListing(ensNaked, account0);
        assert.isAbove(listingIds.nextListingId, listingIds.listingId, "Listing id not incremented after listing");
        var bidInfo = await createBid(ensNaked, ESCROW_DEFAULT_AMT, account1);
        assert.equal(bidInfo.bidStatus.valueOf(), BidStatusEnum.bid, "Bid status not bid");
        bidInfo = await acceptBid(ensNaked, bidInfo.bidId, account0);
        assert.equal(bidInfo.bidStatus, BidStatusEnum.accepted, "Bid status not accepted");
        var escrowInfo = await createEscrow(ensNaked, 0, ESCROW_DEFAULT_AMT, account1);
        assert.isAbove(escrowInfo.nextEscrowId, escrowInfo.escrowId, "Escrow not created");
        assert.equal(escrowInfo.escrowStatus, EscrowStatusEnum.started, "escrow status not set to started");
    }));
    it("Should be able to transfer domain", mochaAsync(async () => {
        var ensNaked = "transfer-domain";
        await register(ensNaked, account0);
        await transferDomainToENSListing(ensNaked, account0);
        var escrowInfo = await createEscrow(ensNaked, 0, ESCROW_DEFAULT_AMT, account1);
        var origDeed = await getDeedInfo(ensNaked);
        assert.equal(origDeed.previousOwner, account0, "original owner incorrect");
        var result = await transferDomainToBuyer(ensNaked, escrowInfo.escrowId, account0);
        assert.equal(result.deedInfo.owner, account1, "new owner incorrect");
        assert.equal(result.escrowInfo.escrowStatus, EscrowStatusEnum.domainTransferred, "escrow status not set to domainTransferred");
    }));
    it("Should be able to withdraw funds after transfer", mochaAsync(async () => {
        var ensNaked = "withdraw-funds";
        await register(ensNaked, account1);
        await transferDomainToENSListing(ensNaked, account1);
        var escrowInfo = await createEscrow(ensNaked, 0, ESCROW_DEFAULT_AMT, account0);
        await transferDomainToBuyer(ensNaked, escrowInfo.escrowId, account1);
        var oldBalance = web3.eth.getBalance(account1);
        var result = await drawFundsAfterTransfer(ensNaked, escrowInfo.escrowId, account1);
        var newBalance = web3.eth.getBalance(account1);
        assert.isAbove(newBalance.valueOf(), oldBalance.valueOf(), "balance did not increase after withdrawl of funds");
        //Accounting for gas expenses
        assert.isAtLeast(newBalance.minus(oldBalance).valueOf(), web3.toWei(0.003, "ether").valueOf(), "balance increase is not close to .003 ether");
        assert.equal(result.escrowInfo.escrowStatus, EscrowStatusEnum.settled, "escrow status not set to settled");

    }));
    it("Should be not able to withdraw funds without transfer", async () => {
        var ensNaked = "withdraw-funds-withoutxfer";
        await register(ensNaked, account1);
        var escrowInfo = await createEscrow(ensNaked, 0, ESCROW_DEFAULT_AMT, account0);
        assert.equal(escrowInfo.escrowStatus, EscrowStatusEnum.started, "escrow status not in started");
        var oldBalance = web3.eth.getBalance(account1);
        try {
            var result = await drawFundsAfterTransfer(ensNaked, escrowInfo.escrowId, account1);
            assert.fail("no error", "error", "Invalid opcode not raised when withdrawing funds without domain transfer");
        } catch (err) {
            assert.include(err.message, 'invalid opcode', "Error code different when withdrawing funds without domain transfer, expected invalid opcode, got " + err.message);
            var escrowInfo = await getEscrowInfo(escrowInfo.escrowId);
            assert.equal(escrowInfo.escrowStatus, EscrowStatusEnum.started, "escrow status not in started");
            return;
        }

    });
    it("Should be able to reject an escrow after transferring ownership to ENSListing", mochaAsync(async () => {
        var ensNaked = "reject-escrow";
        await register(ensNaked, account1);
        var escrowInfo = await createEscrow(ensNaked, 0, ESCROW_DEFAULT_AMT, account0);
        await transferDomainToENSListing(ensNaked, account1);
        var result = await rejectEscrow(ensNaked, escrowInfo.escrowId, 'dont like offer', account1);
        assert.equal(result.escrowInfo.escrowStatus, EscrowStatusEnum.escrowRejected, "escrow status not set to rejected");
    }));
    it("Should be able to reject an escrow without transferring ownership", mochaAsync(async () => {
        var ensNaked = "reject-escrow-withoutxfer";
        await register(ensNaked, account1);
        var escrowInfo = await createEscrow(ensNaked, 0, ESCROW_DEFAULT_AMT, account0);
        var result = await rejectEscrow(ensNaked, escrowInfo.escrowId, 'dont like offer', account1);
        assert.equal(result.escrowInfo.escrowStatus, EscrowStatusEnum.escrowRejected, "escrow status not set to rejected");
    }));
    it("Seller should not be able to writhdraw funds for a rejected escrow", mochaAsync(async () => {
        var ensNaked = "reject-escrow2";
        await register(ensNaked, account1);
        await transferDomainToENSListing(ensNaked, account1);
        var escrowInfo = await createEscrow(ensNaked, 0, ESCROW_DEFAULT_AMT, account0);
        var result = await rejectEscrow(ensNaked, escrowInfo.escrowId, 'dont like offer', account1);
        assert.equal(result.escrowInfo.escrowStatus, EscrowStatusEnum.escrowRejected, "escrow status not set to rejected");
        try {
            await drawFundsAfterTransfer(ensNaked, escrowInfo.escrowId, account1);
            assert.fail("no error", "error", "Invalid opcode not raised when withdrawing funds after reject");
        } catch (err) {
            assert.include(err.message, 'invalid opcode', "Error code different when withdrawing funds after reject, expected invalid opcode, got " + err.message);
            var escrowInfo = await getEscrowInfo(escrowInfo.escrowId);
            assert.equal(escrowInfo.escrowStatus, EscrowStatusEnum.escrowRejected, "escrow status not in escrowRejected");
            return;
        }
    }));
    it("Buyer can withdraw funds after escrow reject", mochaAsync(async () => {
        var ensNaked = "reject-escrow3";
        await register(ensNaked, account1);
        var escrowInfo = await createEscrow(ensNaked, 0, ESCROW_DEFAULT_AMT, account0);
        await transferDomainToENSListing(ensNaked, account1);
        var result = await rejectEscrow(ensNaked, escrowInfo.escrowId, 'dont like offer', account1);
        assert.equal(result.escrowInfo.escrowStatus, EscrowStatusEnum.escrowRejected, "escrow status not set to rejected");
        var oldBalance = web3.eth.getBalance(account0);
        result = await withdrawEscrow(ensNaked, escrowInfo.escrowId, account0);
        var newBalance = web3.eth.getBalance(account0);
        assert.isAbove(newBalance.valueOf(), oldBalance.valueOf(), "balance did not increase after withdrawl of escrow");
        //Accounting for gas expenses
        assert.isAtLeast(newBalance.minus(oldBalance).valueOf(), web3.toWei(0.003, "ether").valueOf(), "balance increase is not close to .003 ether");
        assert.equal(result.escrowInfo.escrowStatus, EscrowStatusEnum.escrowWithdrawn, "escrow status not set to escrowWithdrawn");
    }));

});


contract('EscrowService Balances Tracking',
    function () {
        it('balances, e => $=e',
            mochaAsync(async () => {
                var ensNaked = "e, $=e";
                var buyer = account1, seller = account0;
                await register(ensNaked, seller);
                var oldBalance = getBalances(buyer, seller);
                var escrowInfo = await createEscrow(ensNaked, 0, ESCROW_DEFAULT_AMT, buyer);
                var newBalance = getBalances(buyer, seller);
                assert.isBelow(drop(oldBalance, newBalance, buyer) - increase(oldBalance, newBalance, escrowService.address), GAS_COST_ESTIMATE_ETH, 'drop in buyer more than increase in escrow');
                assert.equal(increase(oldBalance, newBalance, seller), 0, 'seller balance changed');
                assert.equal(await owner(ensNaked), seller, 'owner not seller');
            }));
        it('balances, e, te, tb, d => $=s',
            mochaAsync(async () => {
                var ensNaked = "e, te, tb, d";
                var buyer = account1, seller = account0;
                await register(ensNaked, seller);
                var oldBalance = getBalances(buyer, seller);
                var escrowInfo = await createEscrow(ensNaked, 0, ESCROW_DEFAULT_AMT, buyer);
                await transferDomainToENSListing(ensNaked, seller);
                await transferDomainToBuyer(ensNaked, escrowInfo.escrowId, seller);
                var result = await drawFundsAfterTransfer(ensNaked, escrowInfo.escrowId, seller);
                var newBalance = getBalances(buyer, seller);
                assert.isBelow(drop(oldBalance, newBalance, buyer) - increase(oldBalance, newBalance, seller), GAS_COST_ESTIMATE_ETH, 'drop in buyer more than increase in seller');
                assert.equal(increase(oldBalance, newBalance, escrowService.address), 0, 'escrowService.address balance changed');
                assert.equal(await owner(ensNaked), buyer, 'owner not buyer');
            }));
        it('balances, e, r => $=e',
            mochaAsync(async () => {
                var ensNaked = "e, r $=e";
                var buyer = account1, seller = account0;
                await register(ensNaked, seller);
                var oldBalance = getBalances(buyer, seller);
                var escrowInfo = await createEscrow(ensNaked, 0, ESCROW_DEFAULT_AMT, buyer);
                await rejectEscrow(ensNaked, escrowInfo.escrowId, 'no reason', seller);
                var newBalance = getBalances(buyer, seller);
                assert.isBelow(drop(oldBalance, newBalance, buyer) - increase(oldBalance, newBalance, escrowService.address), GAS_COST_ESTIMATE_ETH, 'drop in buyer more than increase in escrow');
                assert.isBelow(drop(oldBalance, newBalance, seller), GAS_COST_ESTIMATE_ETH, 'seller balance changed');
                assert.equal(await owner(ensNaked), seller, 'owner not seller');
            }));
        it('balances, e, r, w => $=b',
            mochaAsync(async () => {
                var ensNaked = "e, r, w $=b";
                var buyer = account1, seller = account0;
                await register(ensNaked, seller);
                var oldBalance = getBalances(buyer, seller);
                var escrowInfo = await createEscrow(ensNaked, 0, ESCROW_DEFAULT_AMT, buyer);
                await rejectEscrow(ensNaked, escrowInfo.escrowId, 'no reason', seller);
                var result = await withdrawEscrow(ensNaked, escrowInfo.escrowId, buyer);
                var newBalance = getBalances(buyer, seller);
                assert.isBelow(drop(oldBalance, newBalance, buyer), GAS_COST_ESTIMATE_ETH, 'drop in buyer more than gas costs');
                assert.equal(increase(oldBalance, newBalance, escrowService.address), 0, 'escrowService balance changed');
                assert.isBelow(drop(oldBalance, newBalance, seller), GAS_COST_ESTIMATE_ETH, 'seller balance changed');
                assert.equal(await owner(ensNaked), seller, 'owner not seller');
            }));
        it('balances, e, <exp>, w => $=b',
            mochaAsync(async () => {
                var ensNaked = "e, <exp>, w $=b";
                var buyer = account1, seller = account0;
                await register(ensNaked, seller);
                var oldBalance = getBalances(buyer, seller);
                var escrowInfo = await createEscrow(ensNaked, 0, ESCROW_DEFAULT_AMT, buyer);
                await delay(OFFER_LENGTH + 1000);
                var result = await withdrawEscrow(ensNaked, escrowInfo.escrowId, buyer);
                var newBalance = getBalances(buyer, seller);
                assert.isBelow(drop(oldBalance, newBalance, buyer), GAS_COST_ESTIMATE_ETH, 'drop in buyer more than gas costs');
                assert.equal(increase(oldBalance, newBalance, escrowService.address), 0, 'escrowService balance changed');
                assert.isBelow(drop(oldBalance, newBalance, seller), GAS_COST_ESTIMATE_ETH, 'seller balance changed');
                assert.equal(await owner(ensNaked), seller, 'owner not seller');
            }));
        it('balances,  e(b), te, tb, <exp>, d => $=s',
            mochaAsync(async () => {
                var ensNaked = "e(b), te, tb, d";
                var buyer = account1, seller = account0;
                await register(ensNaked, seller);
                var oldBalance = getBalances(buyer, seller);
                var listingIds = await createListing(ensNaked, seller);
                var bidInfo = await createBid(ensNaked, ESCROW_DEFAULT_AMT, buyer);
                bidInfo = await acceptBid(ensNaked, bidInfo.bidId, account0);
                var escrowInfo = await createEscrow(ensNaked, bidInfo.bidId, ESCROW_DEFAULT_AMT, buyer);
                await transferDomainToENSListing(ensNaked, seller);
                await transferDomainToBuyer(ensNaked, escrowInfo.escrowId, seller);
                await delay(OFFER_LENGTH + 1000);
                var result = await drawFundsAfterTransfer(ensNaked, escrowInfo.escrowId, seller);
                var newBalance = getBalances(buyer, seller);
                assert.isBelow(drop(oldBalance, newBalance, buyer) - increase(oldBalance, newBalance, seller), GAS_COST_ESTIMATE_ETH, 'drop in buyer more than increase in seller');
                assert.equal(increase(oldBalance, newBalance, escrowService.address), 0, 'escrowService.address balance changed');
                assert.equal(await owner(ensNaked), buyer, 'owner not buyer');
            }));
        it('balances,  e1, e2, te, tb1, d => $=s,e2',
            mochaAsync(async () => {
                var ensNaked = "e, e, te, tb, d";
                var buyer = account1, seller = account0, buyer2 = account2;
                await register(ensNaked, seller);
                var oldBalance = getBalances(buyer, seller);
                var oldBalance2 = getBalances(buyer2, seller);
                var listingIds = await createListing(ensNaked, seller);
                var bidInfo = await createBid(ensNaked, ESCROW_DEFAULT_AMT, buyer);
                bidInfo = await acceptBid(ensNaked, bidInfo.bidId, account0);
                var escrowInfo = await createEscrow(ensNaked, bidInfo.bidId, ESCROW_DEFAULT_AMT, buyer);
                var escrowInfoAnother = await createEscrow(ensNaked, 0, ESCROW_DEFAULT_AMT, buyer2);
                await transferDomainToENSListing(ensNaked, seller);
                await transferDomainToBuyer(ensNaked, escrowInfo.escrowId, seller);
                var result = await drawFundsAfterTransfer(ensNaked, escrowInfo.escrowId, seller);
                var newBalance = getBalances(buyer, seller);
                var newBalance2 = getBalances(buyer2, seller);
                assert.isBelow(drop(oldBalance, newBalance, buyer) - increase(oldBalance, newBalance, seller), GAS_COST_ESTIMATE_ETH, 'drop in buyer more than increase in seller');
                assert.isBelow(drop(oldBalance2, newBalance2, buyer2) - increase(oldBalance, newBalance, escrowService.address), GAS_COST_ESTIMATE_ETH, 'drop in buyer2 more than increase in escrowService');
                assert.equal(await owner(ensNaked), buyer, 'owner not buyer');
            }));
        it('balances,  e, <exp>, <scv>, s => $=t',
            mochaAsync(async () => {
                var ensNaked = "e, <exp>,<scv>, s";
                var buyer = account1, seller = account0, someone = account2;
                await register(ensNaked, account0);
                var oldBalance = getBalances(buyer, seller);
                var oldTipsBalance = await escrowTipsBalance();
                var escrowInfo = await createEscrow(ensNaked, 0, ESCROW_DEFAULT_AMT, buyer);
                await delay(OFFER_LENGTH + SCAVENGE_LENGTH + 1000);
                var result = await scavengeEscrow(ensNaked, escrowInfo.escrowId, someone);
                var newBalance = getBalances(buyer, seller);
                var newTipsBalance = await escrowTipsBalance();
                assert.isBelow(drop(oldBalance, newBalance, buyer) - increase(oldBalance, newBalance, escrowService.address), GAS_COST_ESTIMATE_ETH, 'drop in buyer more than increase in seller');
                assert.equal(drop(oldBalance, newBalance, seller), 0, 'seller balance changed');
                assert.equal(newTipsBalance.minus(oldTipsBalance), ESCROW_DEFAULT_AMT, 'tipsBalance didnt increase');
                assert.equal(await owner(ensNaked), seller, 'owner not seller');

            }));
    });

contract('EscrowService Can Tip ',
    function () {
        it('tip for e',
            mochaAsync(async () => {
                var ensNaked = "tip for e";
                var buyer = account1, seller = account0;
                await register(ensNaked, seller);
                var oldTipBalance = await escrowTipsBalance();
                var escrowInfo = await createEscrowWithTip(ensNaked, 0, ESCROW_DEFAULT_AMT, buyer, TIP_AMT);
                var newTipBalance = await escrowTipsBalance();
                assert.equal(newTipBalance.minus(oldTipBalance), TIP_AMT, 'tips balance didnt increase');
            }));
        it('tip for e, te, tb',
            mochaAsync(async () => {
                var ensNaked = "tip for e, te, tb";
                var buyer = account1, seller = account0;
                await register(ensNaked, seller);
                var oldTipBalance = await escrowTipsBalance();
                var escrowInfo = await createEscrowWithTip(ensNaked, 0, ESCROW_DEFAULT_AMT, buyer, TIP_AMT);
                await transferDomainToENSListing(ensNaked, seller);
                await transferDomainToBuyerWithTip(ensNaked, escrowInfo.escrowId, seller, TIP_AMT);
                var newTipBalance = await escrowTipsBalance();
                assert.equal(newTipBalance.minus(oldTipBalance).toNumber(), web3.toBigNumber(TIP_AMT).times(2).toNumber(), 'tips balance didnt increase');
            }));
        it('tip for e, te, tb, d',
            mochaAsync(async () => {
                var ensNaked = "tip for e, te, tb, d";
                var buyer = account1, seller = account0;
                await register(ensNaked, seller);
                var oldTipBalance = await escrowTipsBalance();
                var escrowInfo = await createEscrowWithTip(ensNaked, 0, ESCROW_DEFAULT_AMT, buyer, TIP_AMT);
                await transferDomainToENSListing(ensNaked, seller);
                await transferDomainToBuyerWithTip(ensNaked, escrowInfo.escrowId, seller, TIP_AMT);
                await drawFundsAfterTransferWithTip(ensNaked, escrowInfo.escrowId, seller, TIP_AMT);
                var newTipBalance = await escrowTipsBalance();
                assert.equal(newTipBalance.minus(oldTipBalance).toNumber(), web3.toBigNumber(TIP_AMT).times(3).toNumber(), 'tips balance didnt increase');
            }));
        it('tip for e, r',
            mochaAsync(async () => {
                var ensNaked = "tip for e, r";
                var buyer = account1, seller = account0;
                await register(ensNaked, seller);
                var oldTipBalance = await escrowTipsBalance();
                var escrowInfo = await createEscrowWithTip(ensNaked, 0, ESCROW_DEFAULT_AMT, buyer, TIP_AMT);
                await rejectEscrowWithTip(ensNaked, escrowInfo.escrowId, 'no reason', seller, TIP_AMT);
                var newTipBalance = await escrowTipsBalance();
                assert.equal(newTipBalance.minus(oldTipBalance).toNumber(), web3.toBigNumber(TIP_AMT).times(2).toNumber(), 'tips balance didnt increase');
            }));
        it('tip for e, r, w',
            mochaAsync(async () => {
                var ensNaked = "tip for e, r, w";
                var buyer = account1, seller = account0;
                await register(ensNaked, seller);
                var oldTipBalance = await escrowTipsBalance();
                var escrowInfo = await createEscrowWithTip(ensNaked, 0, ESCROW_DEFAULT_AMT, buyer, TIP_AMT);
                await rejectEscrowWithTip(ensNaked, escrowInfo.escrowId, 'no reason', seller, TIP_AMT);
                await withdrawEscrowWithTip(ensNaked, escrowInfo.escrowId, buyer, TIP_AMT);
                var newTipBalance = await escrowTipsBalance();
                assert.equal(newTipBalance.minus(oldTipBalance).toNumber(), web3.toBigNumber(TIP_AMT).times(3).toNumber(), 'tips balance didnt increase');
            }));
    });

contract('EscrowService Abandonment flows', function () {
    it('te, <abd>, ts => o=s',
        mochaAsync(async () => {
            var ensNaked = "te, <abd>, ts, o=s";
            await register(ensNaked, account0);
            await transferDomainToENSListing(ensNaked, account0);
            await listingRegistry.abandonEscrowService(ESCROW_SERVICE_VERSION + 1);
            var result = await transferDomainBackToSeller(ensNaked, account0);
            var deed = await getDeedInfo(ensNaked);
            assert.equal(deed.owner, account0, "o!=s");
        }));
    it("Should not be able to post escrow if contract is abandoned", mochaAsync(async () => {
        var ensNaked = "post-escrow-nodep";
        await register(ensNaked, account0);
        await listingRegistry.abandonEscrowService(ESCROW_SERVICE_VERSION + 1);
        try {
            var escrowInfo = await createEscrow(ensNaked, 0, ESCROW_DEFAULT_AMT, account0);
            assert.fail("no error", "error", "Invalid opcode not raised");
        } catch (err) {
            assert.include(err.message, 'invalid opcode', "Error code different, expected invalid opcode, got " + err.message);
            return;
        }
    }));
    it('<abd>, te => o=e',
        mochaAsync(async () => {
            var ensNaked = "<abd>, te, o=e";
            await register(ensNaked, account0);
            await listingRegistry.abandonEscrowService(ESCROW_SERVICE_VERSION + 1);
            await transferDomainToENSListing(ensNaked, account0);
            var deed = await getDeedInfo(ensNaked);
            assert.equal(deed.owner, escrowService.address, "o!=e");
        }));
    it('<abd>, te, ts => o=s',
        mochaAsync(async () => {
            var ensNaked = "<abd>, te, ts, o=s";
            await register(ensNaked, account0);
            await listingRegistry.abandonEscrowService(ESCROW_SERVICE_VERSION + 1);
            await transferDomainToENSListing(ensNaked, account0);
            var result = await transferDomainBackToSeller(ensNaked, account0);
            var deed = await getDeedInfo(ensNaked);
            assert.equal(deed.owner, account0, "o!=s");
        }));

});
