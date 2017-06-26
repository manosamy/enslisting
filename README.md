# enslisting
enslisting.com smart contacts, api

Review the smart contracts that are backing enslisting.com
There are two main services:
ListingService
EscrowService

run the tests against your local node:

```
truffle test
```

Sample output:

```
PS C:\enslistingapi\enslisting> truffle test
Using network 'development'.

1498439420351
skipping account unlocks for network 1498439420351


ENS Registrar loaded from: 0x94dfeceb91678ec912ef8f14c72721c102ed2df7
Registry loaded from: 0x25d02115bd67258a406a0f676147e6c3598a91a9
Listing DB loaded from: 0x9ce4cd6d7f5e8b14c7a3e8e6a257a86bd5a6eea0
EscrowService loaded from: 0xdc78afe9cfde0576ff236667dc8c380615c24ca9
ListingService loaded from: 0xb349fb172d6d5f693b0aa1c6eec4c61cfd6846f4
  Contract: EscrowService Happy Path
    v should be able to e, te, tb, d (731ms)
    v should be able to te, e, tb, d (634ms)
    v should be able to e, e, te, tb, d (807ms)
    v should be able to e(b), te, tb, d (910ms)
    v should be able to e, r, w (551ms)
    v should be able to e, te, to (685ms)
    v should be able to e, <exp>, w (4393ms)
    v should be able to e, <exp>,<scv>, s (3350ms)

  Contract: EscrowService Banned Flows
    v dont allow e,w (186ms)
    v dont allow e, d (187ms)
    v dont allow e, te, d (302ms)
    v dont allow e, tb (170ms)
    v dont allow e, r, tb (417ms)
    v dont allow e, r, te, tb (524ms)
    v dont allow e, <exp>, tb (3233ms)
    v dont allow e, te, <exp>, tb (3386ms)
    v dont allow e, <exp>, te, tb (3293ms)
    v dont allow e, <exp>, w, w (4456ms)
    v dont allow e, r, w, w (559ms)
    v dont allow e(b), te, tb, d, d (948ms)
    v dont allow e(b), te, tb, d, <exp>, w (3984ms)
    v dont allow e, <exp>, <scv>, s, w (3320ms)
    v dont allow e, <exp>, <scv>, s, te, tb (3458ms)
    v dont allow e(b), te, tb, to (1005ms)
    v dont allow e(b), te, tb, d, to (1001ms)
    v dont allow e(b), te, to, tb (774ms)
    v dont allow e, e, te, tb, tb (568ms)
    v dont allow e, e, te, tb, d, d (762ms)

  Contract: EscrowService Status Tracking
    v should set status to started when escrow starts (171ms)
    v should set status to domainTransferred after transfer (500ms)
    v should set status to settled after transfer and draw funds (629ms)
    v escrow should stay as-is if seller xfers domain back (376ms)
    v should set status to rejected after rejection (322ms)
    v should set status to escrowWithdrawn after withdrawl (611ms)
    v should be able to scavenge escrow in started status (3441ms)
    v should able to scavenge escrow after transfer before draw funds (3585ms)
    v should be able to scavenge escrow after rejection (3605ms)
    v should not be able to scavenge escrow after settled (3734ms)
    v should not be able to scavenge escrow after withdrawl (3582ms)
    v should not be able to scavenge escrow in scavenged status (3526ms)

  Contract: EscrowService Ownership Tracking
    v te => o=e (230ms)
    v te, ts => o=s (309ms)
    v e => o=s (244ms)
    v e, te => o=e (346ms)
    v e, te,tb => o=b (549ms)
    v e, te,r => o=e (586ms)
    v e, te,ts => o=s (422ms)
    v e, te,r,ts => o=s (576ms)
    v e, te, <exp> => o=e (3374ms)
    v e, te, <exp>, ts => o=s (3416ms)
    v e, te, <exp>, <scv> => o=e (3559ms)
    v e, te, <exp>, <scv>, ts => o=s (3595ms)

  Contract: EscrowService few end-to-end Flows
    v Should be able to post escrow without any dependencies (159ms)
    v Should be able to post escrow for a listed domain (259ms)
    v Should be able to post escrow for a domain with accepted bid (518ms)
    v Should be able to transfer domain (516ms)
    v Should be able to withdraw funds after transfer (921ms)
    v Should be not able to withdraw funds without transfer (390ms)
    v Should be able to reject an escrow after transferring ownership to ENSListing (519ms)
    v Should be able to reject an escrow without transferring ownership (344ms)
    v Seller should not be able to writhdraw funds for a rejected escrow (532ms)
    v Buyer can withdraw funds after escrow reject (1020ms)

  Contract: EscrowService Balances Tracking
    v balances, e => $=e (1135ms)
    v balances, e, te, tb, d => $=s (1790ms)
    v balances, e, r => $=e (1445ms)
    v balances, e, r, w => $=b (1647ms)
    v balances, e, <exp>, w => $=b (4460ms)
    v balances,  e(b), te, tb, <exp>, d => $=s (5107ms)
    v balances,  e1, e2, te, tb1, d => $=s,e2 (3225ms)
    v balances,  e, <exp>, <scv>, s => $=t (4423ms)

  Contract: EscrowService Can Tip
    v tip for e (286ms)
    v tip for e, te, tb (524ms)
    v tip for e, te, tb, d (741ms)
    v tip for e, r (511ms)
    v tip for e, r, w (621ms)

  Contract: EscrowService Abandonment flows
    v te, <abd>, ts => o=s (295ms)
    v Should not be able to post escrow if contract is abandoned (78ms)
    v <abd>, te => o=e (224ms)
    v <abd>, te, ts => o=s (311ms)


  79 passing (2m)
 ```
