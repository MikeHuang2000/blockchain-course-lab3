# 2026《区块链技术与应用》(微众银行)

## 实验 3: 托管交易合约与合约工程化

### 一、实验目标

实验2你写的ERC20是”一种资产”。真实的链上应用是”用资产做一件事”:买卖、借贷、拍卖、众筹。本实验你要写一个托管交易合约 Escrow: 买家把代币存进合约,收到货后确认放款给卖家;超期没收到货可以退款;有争议时由仲裁人裁决。

和实验2相比有三样新东西:合约调用另一个合约、订单状态机、用Hardhat 写单元测试。做完后,大作业就是给这个合约包一层应用。

| 新概念              | 本实验中你会看到的证据                               | 对应章节 |
| :------------------ | :--------------------------------------------------- | :------- |
| 合约调用合约、接口  | Escrow 里通过 IERC20 调用你实验2的代币               | 第4节    |
| 谁是 `msg.sender`   | 代币合约眼中的调用者是 Escrow 而不是买家             | 第4、7节 |
| 状态机与多角色权限  | 每个函数只在特定状态、由特定角色调用                 | 第4、7节 |
| 链上时间            | 与 `block.timestamp` deadline 的比较                 | 第4、5节 |
| 单元测试与 gas 报告 | Hardhat 测试全绿,gas报告表                           | 第5节    |
| 脚本化部署          | 带你学号的部署 tags, `deployedContracts.ts` 自动更新 | 第6节    |
| 事件作为链上日志    | 块浏览器里的 `OrderCreated` 事件                     | 第7节    |

### 二、约定

三人一组轮换角色。每人各自部署一份 Escrow合约,仲裁人填组内另一位同学的地址。每人在自己的合约上当一次买家,走完全部流程。三人分别是买家A、卖家B、仲裁人C,轮一圈之后每人都做过三种角色。人数不整除时,两人一组,仲裁人填助教公布的地址。代币用买家自己实验2的ERC20。

命名规则。部署 tags 为 Escrow 加姓名拼音首字母加学号,例如 `EscrowZS202200123`。

【截图】与【解释】约定同前。本实验里合约地址、订单里的买家卖家地址、每笔交易哈希都是唯一的。

> 关于AI工具:政策同前。提醒一句,本实验的解释题里有两道关于”msg.sender 是谁”的题,AI对这类题经常答错,验收时会重点问。

---

### 三、认识 Hardhat 项目

实验2用的 Remix 适合写小合约,但没法自动化测试、没法脚本化部署。本实验起改用 Hardhat,示例项目是课前清单里 clone 过的 `my-first-dapp`。

```bash
cd ~/blockchain-course/my-first-dapp
ls packages/hardhat/contracts packages/hardhat/test packages/hardhat/deploy
```

三个目录的分工:`contracts` 放合约源码, `test` 放测试, `deploy` 放部署脚本。先跑一遍示例项目自带的测试,确认环境正常:

```bash
yarn compile
yarn hardhat:test
```

测试在 Hardhat 内置的内存链上运行,不连测试网、不花gas、几秒钟跑完。输出末尾有一张 gas 报告表。

**【截图 3-1】** `yarn hardhat:test` 的输出,包含通过的用例数和 gas 报告表。
*(图3.1 `yarn hardhat:test` 的输出:示例项目2个用例通过,末尾是gas 报告表)*

**【解释 3-1】** 这些测试跑在哪条链上?它和实验1的本地链、实验2的POTOS 测试网各是什么关系?为什么测试不需要 MetaMask 签名?

---

### 四、写 Escrow 合约

#### 4.1 业务规则

一笔订单的生命周期:
`Created` ——deposit(买家)——> `Paid` ——confirm(买家)——> `Completed`
`Paid` ——refund(买家,超过 deadline)——> `Refunded`
`Paid` ——dispute(买家或卖家)——> `Disputed` ——resolve(仲裁人)——> `Completed` 或 `Refunded`

*   买家创建订单时指定卖家、用哪种代币、金额、截止时间、描述。
*   买家付款:代币从买家转进 Escrow 合约。前提是买家先在代币合约上 approve Escrow。
*   买家确认收货:Escrow 把代币转给卖家。
*   超过截止时间买家还没确认,买家可以退款。
*   付款后任一方可发起争议,仲裁人裁决给卖家或退给买家。

#### 4.2 合约骨架

把实验2的代币合约拷贝进项目,再新建 `packages/hardhat/contracts/Escrow.sol`,粘贴下面的骨架。已写好的部分不要改,六个TODO由你完成。

```bash
cp /path/to/ZSToken.sol packages/hardhat/contracts/
```

```solidity
// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

// 只声明我们要用的三个函数。Escrow 通过这个接口去调用任何ERC20合约。
interface IERC20 {
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract Escrow {
    // 状态机
    enum Status { Created, Paid, Completed, Refunded, Disputed }
    
    struct Order {
        address buyer;
        address seller;
        // 用哪种 ERC20 结算
        address token;
        uint256 amount; // 最小单位
        uint256 deadline; // unix时间戳,秒
        Status status;
        string description;
    }
    
    // 存储
    address public arbiter;
    uint256 public orderCount;
    mapping(uint256 => Order) private _orders;
    
    // 事件
    event OrderCreated(uint256 indexed id, address indexed buyer, address indexed seller, address token, uint256 amount, uint256 deadline);
    event OrderPaid(uint256 indexed id);
    event OrderCompleted(uint256 indexed id);
    event OrderRefunded(uint256 indexed id);
    event OrderDisputed(uint256 indexed id, address by);
    event OrderResolved(uint256 indexed id, bool sellerWins);

    // 修饰器
    modifier onlyArbiter() {
        require(msg.sender == arbiter, "Escrow: caller is not the arbiter");
        _;
    }
    modifier onlyBuyer(uint256 id) {
        require(msg.sender == _orders[id].buyer, "Escrow: caller is not the buyer");
        _;
    }
    modifier inStatus(uint256 id, Status s) {
        require(_orders[id].status == s, "Escrow: wrong status");
        _;
    }

    constructor(address _arbiter) {
        require(_arbiter != address(0), "Escrow: arbiter is the zero address");
        arbiter = _arbiter;
    }

    function getOrder(uint256 id) public view returns (Order memory) {
        require(id < orderCount, "Escrow: order does not exist");
        return _orders[id];
    }

    // TODO 1: 创建订单
    // 要求: seller 不能是零地址、不能是自己;amount 大于0;deadline 必须在未来;
    // 订单 id为当前 orderCount,写入orders, orderCount加一;
    // buyer 是 msg.sender,状态 Created;发出 OrderCreated;返回 id。
    function createOrder(address seller, address token, uint256 amount, uint256 deadline, string memory description) public returns (uint256) {
        // TODO
    }

    // TODO 2: 买家付款
    // 要求: 只有买家、只在Created 状态(用修饰器);
    // 先把状态改为Paid,再调用代币的transferFrom 把 amount 从买家转到本合约(address(this));
    // transferFrom 返回false 要 revert;发出 OrderPaid。
    // 提示:IERC20(o.token).transferFrom(...)。想清楚代币合约看到的msg.sender是谁。
    function deposit(uint256 id) public onlyBuyer(id) inStatus(id, Status.Paid) {
        // TODO (注意:上面这行修饰器里的状态写错了,先改对再往下写)
    }

    // TODO 3: 买家确认收货
    // 要求: 只有买家、只在Paid 状态;状态改为Completed;代币转给卖家,发出 OrderCompleted。
    function confirm(uint256 id) public {
        // TODO
    }

    // TODO 4: 超期退款
    // 要求: 只有买家、只在Paid 状态;block.timestamp 必须大于 deadline;
    // 状态改为Refunded;代币退回买家;发出OrderRefunded。
    function refund(uint256 id) public {
        // TODO
    }

    // TODO 5: 发起争议
    // 要求: 只在Paid状态;调用者必须是买家或卖家;状态改为 OrderDisputed
    function dispute(uint256 id) public {
        // TODO
    }

    // TODO 6: 仲裁
    // 要求: 只有仲裁人、只在Disputed 状态;
    // sellerWins为true 则状态 Completed、代币给卖家,否则状态 Refunded、代币退买家;
    // 发出 OrderResolved。
    function resolve(uint256 id, bool sellerWins) public {
        // TODO
    }
}
```

几个新语法:

*   `IERC20(o.token)` 把一个地址当作 IERC20 接口来用,之后就能 `.transfer(...)`。
*   `address(this)` 是本合约自己的地址。
*   `Order storage o = _orders[id];` 拿到存储引用,改 `o.status` 会直接改链上数据。 `Order memory` 则是拷贝一份。
*   `block.timestamp` 是当前区块的时间戳,单位秒。

**一个必须遵守的顺序**。在 `deposit`、`confirm`、`refund`、`resolve`里,先改状态,再调用外部合约转账。原因在第5节的解释题里让你自己想,大作业的挑战题会用一个反例让你看到不遵守会怎样。

```bash
yarn compile
```

**【截图 3-2】** 编译成功的输出,以及你完成后的6个函数源码。
*(图3.2 `yarn compile` 成功:生成 typings, Compiled Solidity files successfully)*

**【解释 3-2】** `deposit` 里调用 `IERC20(o.token).transferFrom(msg.sender, address(this), o.amount)` 时,代币合约内部看到的 `msg.sender` 是谁?由此说明买家在付款前应该 approve 给哪个地址,approve 给卖家行不行?

**【解释 3-3】** 骨架里 `deposit` 的修饰器故意写成了 `inStatus(id, Status.Paid)`。如果不改,会出现什么现象?描述一个买家从创建到付款的操作序列,指出在哪一步、因为哪个 require 失败。

---

### 五、写单元测试

#### 5.1 测试骨架

新建 `packages/hardhat/test/Escrow.ts`。下面给出 fixture 和两个示例用例,剩下的由你补齐。

```typescript
import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";

const AMOUNT = ethers.parseUnits("30", 18);

async function deployFixture() {
    const [deployer, buyer, seller, arbiter, stranger] = await ethers.getSigners();
    const token = await ethers.deployContract("ZSToken"); // 换成你的合约名
    await token.mint(buyer.address, ethers.parseUnits("100", 18)); // deployer 是 owner
    
    const escrow = await ethers.deployContract("Escrow", [arbiter.address]);
    const deadline = (await time.latest()) + 3600;
    
    return { token, escrow, deployer, buyer, seller, arbiter, stranger, deadline };
}

describe("Escrow", function () {
    it("createOrder 记录订单并发出事件", async function () {
        const { token, escrow, buyer, seller, deadline } = await loadFixture(deployFixture);
        await expect(
            escrow.connect(buyer).createOrder(seller.address, await token.getAddress(), AMOUNT, deadline, "一本书")
        )
            .to.emit(escrow, "OrderCreated")
            .withArgs(0, buyer.address, seller.address, await token.getAddress(), AMOUNT, deadline);
            
        const order = await escrow.getOrder(0);
        expect(order.buyer).to.equal(buyer.address);
        expect(order.status).to.equal(0); // Created
        expect(await escrow.orderCount()).to.equal(1);
    });

    it("未 approve 时 deposit 失败", async function () {
        const { token, escrow, buyer, seller, deadline } = await loadFixture(deployFixture);
        await escrow.connect(buyer).createOrder(seller.address, await token.getAddress(), AMOUNT, deadline, "一本书");
        
        await expect(escrow.connect(buyer).deposit(0)).to.be.revertedWith("ZSToken: insufficient allowance"); //换成你代币里的报错文字
    });

    // TODO:补齐下面6个用例
    it("approve 后 deposit 成功,代币进入Escrow,状态变为Paid");
    it("非买家调用 confirm 失败");
    it("confirm 后卖家收到代币,状态变为 Completed");
    it("deadline 之前refund失败,deadline 之后 refund 成功并退回买家");
    it("非仲裁人调用resolve 失败");
    it("dispute 后仲裁人 resolve(false)退款给买家,状态变为Refunded");
});
```

会用到的写法:

*   用某个账户调用: `escrow.connect(buyer).deposit(0)`。
*   期望失败并检查报错文字: `await expect(...).to.be.revertedWith("Escrow: wrong status")`。
*   查余额: `await token.balanceOf(await escrow.getAddress())`。
*   让链上时间前进一小时: `await time.increase(3600)`。
*   只写了标题没有函数体的 `it("...")` 会显示为 pending,不算通过。

```bash
yarn hardhat:test
```

**【截图 3-3】** 全部8个用例通过的输出和 gas 报告表。
*(图3.3 `yarn hardhat:test` 全绿:Escrow的8个用例通过(示例自带的 YourContract 2个也在内), 下方是各函数 gas 报告表)*

**【解释 3-4】** gas 报告里 `createOrder` `deposit` `confirm` 三个函数各消耗多少 gas? 哪个最贵?结合每个函数写了几个存储槽、调用了几次外部合约解释。

**【解释 3-5】** `time.increase(3600)` 在测试里让时间前进了一小时。在真实的 POTOS 测试网上你能这样做吗? `block.timestamp` 由谁决定,它可信到什么程度?如果你的合约用 `block.timestamp` 做秒级的判断会有什么风险?

**【解释 3-6】** 为什么要”先改状态,再调外部合约”?设想 `deposit` 写成先 `transferFrom` 再改状态,而代币合约是别人写的、内容未知,可能出什么问题?(大作业挑战题会让你亲手做一次。)

---

### 六、部署到 POTOS 测试网

#### 6.1 私钥

```bash
export _RUNTIME_DEPLOYER_PRIVATE_KEY=0x你的私钥
```

从MetaMask 导出,账户里要有 POT。这个变量只在当前终端有效,不要写进任何文件。

#### 6.2 部署脚本

新建 `packages/hardhat/deploy/01_deploy_token.ts` 和 `02_deploy_escrow.ts`。`<仲裁人地址>`填你们组里担任仲裁人的同学的 MetaMask 地址。

```typescript
// 01_deploy_token.ts
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const deployToken: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { deployer } = await hre.getNamedAccounts();
    await hre.deployments.deploy("ZSToken", { from: deployer, args: [], log: true, autoMine: true });
};
export default deployToken;
deployToken.tags = ["TokenZS202200123"];
```

```typescript
// 02_deploy_escrow.ts
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const ARBITER ="<仲裁人地址>";

const deployEscrow: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { deployer } = await hre.getNamedAccounts();
    await hre.deployments.deploy("Escrow", { from: deployer, args: [ARBITER], log: true, autoMine: true });
};
export default deployEscrow;
deployEscrow.tags = ["EscrowZS202200123"];
```

```bash
yarn deploy --tags TokenZS202200123
yarn deploy --tags EscrowZS202200123
ls packages/hardhat/deployments/potos_testnet/
grep -n "Escrow\|ZSToken" packages/nextjs/contracts/deployedContracts.ts
```

**【截图 3-4】** 两次 yarn deploy 的输出,包含交易哈希和合约地址。
*(图3.4 两次 `yarn deploy` 的输出: ZSToken与Escrow 各自的部署交易哈希、合约地址,以及自动更新 `deployedContracts.ts`)*

**【解释 3-7】** 你的 Escrow 合约里 arbiter 是谁?部署交易的 From 是谁?两者为什么可以不同?

#### 6.3 让组员也能操作你的合约

启动前端,Debug Contracts 页面会列出刚部署的两个合约:

```bash
yarn start
```

组员要操作你的合约有两种办法:把你的仓库 clone 下来 `yarn install && yarn start`,或者在 Remix 里用 At Address 加载(Escrow 源码大家相同,代币源码你发给他们)。建议用第一种,大作业也要用。

---

### 七、三人走完一笔托管交易

以下是买家A(合约部署者),B是卖家,C是仲裁人。所有操作在 Debug Contracts 页面进行,每一步 MetaMask 弹窗确认。金额统一用18位精度。

#### 7.1 正常成交

| 步   | 谁   | 操作                                                         | 期望                                              |
| :--- | :--- | :----------------------------------------------------------- | :------------------------------------------------ |
| 1    | A    | 代币合约 `mint` (A, 100个)                                   | 成功                                              |
| 2    | A    | 终端执行 `date +%s`,加1800 得到 30 分钟后的时间戳            | 记下这个数                                        |
| 3    | A    | Escrow `createOrder` (B 地址,代币地址,30 个,时间戳,“实验 3订单”) | 成功, `getOrder(0)` 的 status为0                  |
| 4    | A    | Escrow `deposit(0)`                                          | 失败,还没 approve                                 |
| 5    | A    | 代币合约 `approve` (Escrow 地址,30个)                        | 成功                                              |
| 6    | A    | Escrow `deposit(0)`                                          | 成功, status为 1, 代币 `balanceOf(Escrow)` 为30个 |
| 7    | B    | Escrow `confirm(0)`                                          | 失败,不是买家                                     |
| 8    | A    | Escrow `refund(0)`                                           | 失败,未到 deadline                                |
| 9    | A    | Escrow `confirm(0)`                                          | 成功, status 为 2, `balanceOf(B)` 为 30个         |

**【截图 3-5】** 第3步成功后 `getOrder(0)` 的返回值,以及区块浏览器里这笔交易的 OrderCreated 事件。
*(图3.5 createOrder 的MetaMask 确认弹窗)*
*(图3.6 第3步成功后 getOrder(0): ① status为0 (Created),买家、卖家、代币、金额都已写入)*

**【截图 3-6】** 第4步失败、第6步成功后的 `getOrder(0)` 和 `balanceOf(Escrow)`。
*(图3.7 第4步:还没 approve 就 deposit,页面弹出 execution reverted)*
*(图3.8 第5步approve 的MetaMask 弹窗:①支出上限30 ②支出者是 Escrow 合约)*
*(图3.9 第6步 deposit 成功:左 getOrder(0) 的status 变为1 (Paid),右 balanceOf(Escrow) 为 30个)*

**【截图 3-7】** 第7、8步的失败提示,第9步后 `balanceOf(B)`。
*(图3.10 第7步卖家B调 confirm 失败)*
*(图3.11 第8步买家未到 deadline 调 refund 失败)*
*(图3.12 第9步confirm成功:左getOrder(0)的status 变为2(Completed),右 balanceOf(B) 为30个)*

**【解释 3-8】** 第4步和第6步之间只多了一次 approve。第6步这笔交易里发生了几次合约调用,分别是谁调用谁?在区块浏览器里这笔交易的 Logs 里应该能看到两个事件,分别是哪两个、由哪个合约发出?
*(图3.13 deposit 交易在 Blockscout 的Logs 页)*

#### 7.2 争议与仲裁

| 步   | 谁   | 操作                                             | 期望                                    |
| :--- | :--- | :----------------------------------------------- | :-------------------------------------- |
| 10   | A    | `createOrder` 第二笔,同上参数,描述改为”争议订单” | id为1                                   |
| 11   | A    | `approve` 30 个, `deposit(1)`                    | status为1                               |
| 12   | B    | `dispute(1)`                                     | 成功,status为4                          |
| 13   | A    | `resolve(1, false)`                              | 失败,不是仲裁人                         |
| 14   | C    | `resolve(1, false)`                              | 成功, status为 3, A的代币余额回到付款前 |

**【截图 3-8】** 第12步后 `getOrder(1)`、第13步失败、第14步后 `getOrder(1)` 与 A 的余额。
*(图3.14 第12步 dispute 后 getOrder(1) 的status为4 (Disputed))*
*(图3.15 第13步买家 A调 resolve 失败)*
*(图3.16 第14步仲裁人C的resolve 弹窗)*
*(图3.17 第14步 resolve(1, false) 后:左getOrder(1)的status为3(Refunded),右 balanceOf(A) 回到70个)*
*(图3.18 买家的代币余额:退款后回到70个)*
*(图3.19 resolve 交易在 Blockscout 的 Logs页)*

**【解释 3-9】** 仲裁人C从头到尾没有持有过任何代币,也没有 approve过任何人,为什么他能把 Escrow 里的代币转给A?这些代币在争议期间”属于”谁?

#### 7.3 超期退款 (选做,加2分)

| 步   | 谁   | 操作                                                | 期望           |
| :--- | :--- | :-------------------------------------------------- | :------------- |
| 15   | A    | `createOrder` 第三笔, deadline 填 `date +%s` 加 180 | id为2          |
| 16   | A    | `approve` 并 `deposit(2)`                           | status 为1     |
| 17   | A    | 立刻 `refund(2)`                                    | 失败           |
| 18   | A    | 等4分钟后 `refund(2)`                               | 成功,status为3 |

**【截图 3-9】** 第17步失败与第18步成功。
*(图3.20 第17步未到期 refund 失败;等过 deadline 后第 18步 refund 成功)*
*(图3.21 第18步 refund 成功后 getOrder(2) 的status为3 (Refunded))*

#### 7.4 换角色

三人轮换,每人在自己部署的合约上当一次买家,完成7.1和7.2。报告里只需要贴自己当买家那一轮的截图,但关键数据表要写清三份合约的地址和你在各合约里的角色。

---

### 八、思考题

写在报告里,每题100到200字。

1.  本合约的规则下,买家收到货后故意不确认,拖到 deadline 之后退款,卖家钱货两空。卖家有什么办法?合约应该怎么改才能堵住这个漏洞?至少给出一种改法并说明它引入的新问题。
2.  仲裁人是一个单一地址,他可以随意裁决。现实里的托管平台怎么解决”仲裁人作恶”的问题?把仲裁人换成多签或投票,合约要改哪些地方?
3.  前端要显示”所有订单列表”。方案一是循环调用 `getOrder(0)` 到 `getOrder(orderCount 减1)`;方案二是查询历史 `OrderCreated` 事件。两种方案各在什么情况下更合适?为什么 Solidity 不鼓励在合约里存一个订单数组并返回整个数组?

---

### 九、提交清单

| 项目                                                         | 数量    |
| :----------------------------------------------------------- | :------ |
| 截图 3-1到3-8 (3-9选做)                                      | 8组     |
| 解释题 3-1 到3-9                                             | 9题     |
| 思考题                                                       | 3题     |
| Escrow.sol 完整源码、Escrow.ts 完整测试                      | 2个文件 |
| 关键数据表:三份 Escrow 地址与你的角色、你的代币地址、订单0和1的全部交易哈希 | 1 张表  |
| AI 使用说明                                                  | 1段     |

---

### 十、常见问题

*   `yarn hardhat:test` 报 Cannot find module。 yarn install 没完成,回到课前清单。
*   测试里 revertedWith 的文字对不上。报错文字必须和你合约里 require 的字符串完全一致,包括标点和空格。
*   deposit 在测试里成功,在测试网上失败。通常是 approve 给错了地址(给了卖家而不是Escrow),或者精度没带18个0。
*   createOrder 报 deadline in the past。时间戳单位是秒不是毫秒,用 `date +%s`,不要用 JavaScript 的 `Date.now()`。
*   组员 Debug Contracts 页面看不到我的合约。他要 clone 我的仓库并 `yarn start`,页面读的是仓库里的 `deployedContracts.ts`。
*   deploy 时报 arbiter is the zero address。 02 脚本里的 ARBITER 没有替换。
