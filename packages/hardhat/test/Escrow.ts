import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";

const AMOUNT = ethers.parseUnits("30", 18);

async function deployFixture() {
  const [deployer, buyer, seller, arbiter, stranger] = await ethers.getSigners();
  const token = await ethers.deployContract("HMKToken"); // deployer 是 owner
  await token.mint(buyer.address, ethers.parseUnits("100", 18));

  const escrow = await ethers.deployContract("Escrow", [arbiter.address]);
  const deadline = (await time.latest()) + 3600;

  return { token, escrow, deployer, buyer, seller, arbiter, stranger, deadline };
}

describe("Escrow", function () {
  it("createOrder 记录订单并发出事件", async function () {
    const { token, escrow, buyer, seller, deadline } = await loadFixture(deployFixture);
    await expect(
      escrow.connect(buyer).createOrder(seller.address, await token.getAddress(), AMOUNT, deadline, "一本书"),
    )
      .to.emit(escrow, "OrderCreated")
      .withArgs(0, buyer.address, seller.address, await token.getAddress(), AMOUNT, deadline);

    const order = await escrow.getOrder(0);
    expect(order.buyer).to.equal(buyer.address);
    expect(order.seller).to.equal(seller.address);
    expect(order.status).to.equal(0); // Created
    expect(order.description).to.equal("一本书");
    expect(await escrow.orderCount()).to.equal(1);
  });

  it("未 approve 时 deposit 失败", async function () {
    const { token, escrow, buyer, seller, deadline } = await loadFixture(deployFixture);
    await escrow.connect(buyer).createOrder(seller.address, await token.getAddress(), AMOUNT, deadline, "一本书");

    await expect(escrow.connect(buyer).deposit(0)).to.be.revertedWith("HMKToken: insufficient allowance");
  });

  it("approve 后 deposit 成功,代币进入Escrow,状态变为Paid", async function () {
    const { token, escrow, buyer, seller, deadline } = await loadFixture(deployFixture);
    await escrow.connect(buyer).createOrder(seller.address, await token.getAddress(), AMOUNT, deadline, "一本书");

    await expect(token.connect(buyer).approve(await escrow.getAddress(), AMOUNT))
      .to.emit(token, "Approval")
      .withArgs(buyer.address, await escrow.getAddress(), AMOUNT);

    await expect(escrow.connect(buyer).deposit(0)).to.emit(escrow, "OrderPaid").withArgs(0);

    expect(await token.balanceOf(await escrow.getAddress())).to.equal(AMOUNT);
    expect(await token.balanceOf(buyer.address)).to.equal(ethers.parseUnits("70", 18));
    expect((await escrow.getOrder(0)).status).to.equal(1); // Paid
  });

  it("非买家调用 confirm 失败", async function () {
    const { token, escrow, buyer, seller, stranger, deadline } = await loadFixture(deployFixture);
    await escrow.connect(buyer).createOrder(seller.address, await token.getAddress(), AMOUNT, deadline, "一本书");
    await token.connect(buyer).approve(await escrow.getAddress(), AMOUNT);
    await escrow.connect(buyer).deposit(0);

    await expect(escrow.connect(stranger).confirm(0)).to.be.revertedWith("Escrow: caller is not the buyer");
    await expect(escrow.connect(seller).confirm(0)).to.be.revertedWith("Escrow: caller is not the buyer");
  });

  it("confirm 后卖家收到代币,状态变为 Completed", async function () {
    const { token, escrow, buyer, seller, deadline } = await loadFixture(deployFixture);
    await escrow.connect(buyer).createOrder(seller.address, await token.getAddress(), AMOUNT, deadline, "一本书");
    await token.connect(buyer).approve(await escrow.getAddress(), AMOUNT);
    await escrow.connect(buyer).deposit(0);

    await expect(escrow.connect(buyer).confirm(0)).to.emit(escrow, "OrderCompleted").withArgs(0);

    expect(await token.balanceOf(seller.address)).to.equal(AMOUNT);
    expect(await token.balanceOf(await escrow.getAddress())).to.equal(0);
    expect((await escrow.getOrder(0)).status).to.equal(2); // Completed
  });

  it("deadline 之前refund失败,deadline 之后 refund 成功并退回买家", async function () {
    const { token, escrow, buyer, seller, deadline } = await loadFixture(deployFixture);
    await escrow.connect(buyer).createOrder(seller.address, await token.getAddress(), AMOUNT, deadline, "一本书");
    await token.connect(buyer).approve(await escrow.getAddress(), AMOUNT);
    await escrow.connect(buyer).deposit(0);

    await expect(escrow.connect(buyer).refund(0)).to.be.revertedWith("Escrow: deadline has not passed");

    await time.increase(3600);

    await expect(escrow.connect(buyer).refund(0)).to.emit(escrow, "OrderRefunded").withArgs(0);

    expect(await token.balanceOf(buyer.address)).to.equal(ethers.parseUnits("100", 18));
    expect(await token.balanceOf(await escrow.getAddress())).to.equal(0);
    expect((await escrow.getOrder(0)).status).to.equal(3); // Refunded
  });

  it("非仲裁人调用resolve 失败", async function () {
    const { token, escrow, buyer, seller, stranger, deadline } = await loadFixture(deployFixture);
    await escrow.connect(buyer).createOrder(seller.address, await token.getAddress(), AMOUNT, deadline, "一本书");
    await token.connect(buyer).approve(await escrow.getAddress(), AMOUNT);
    await escrow.connect(buyer).deposit(0);
    await escrow.connect(seller).dispute(0);

    await expect(escrow.connect(buyer).resolve(0, false)).to.be.revertedWith("Escrow: caller is not the arbiter");
    await expect(escrow.connect(stranger).resolve(0, true)).to.be.revertedWith("Escrow: caller is not the arbiter");
  });

  it("dispute 后仲裁人 resolve(false)退款给买家,状态变为Refunded", async function () {
    const { token, escrow, buyer, seller, arbiter, deadline } = await loadFixture(deployFixture);
    await escrow.connect(buyer).createOrder(seller.address, await token.getAddress(), AMOUNT, deadline, "一本书");
    await token.connect(buyer).approve(await escrow.getAddress(), AMOUNT);
    await escrow.connect(buyer).deposit(0);

    await expect(escrow.connect(seller).dispute(0)).to.emit(escrow, "OrderDisputed").withArgs(0, seller.address);
    expect((await escrow.getOrder(0)).status).to.equal(4); // Disputed

    await expect(escrow.connect(arbiter).resolve(0, false)).to.emit(escrow, "OrderResolved").withArgs(0, false);

    expect((await escrow.getOrder(0)).status).to.equal(3); // Refunded
    expect(await token.balanceOf(buyer.address)).to.equal(ethers.parseUnits("100", 18));
    expect(await token.balanceOf(seller.address)).to.equal(0);
    expect(await token.balanceOf(await escrow.getAddress())).to.equal(0);
  });
});
