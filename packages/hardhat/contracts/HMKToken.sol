// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

contract HMKToken {
    // ---------- 元数据 ----------
    string public name = "HMKToken";
    string public symbol = "HMK202430552423";
    uint8 public decimals = 18;
    uint256 public totalSupply;

    // ---------- 权限 ----------
    address public owner;

    modifier onlyOwner() {
        require(msg.sender == owner, "HMKToken: caller is not the owner");
        _; // 修饰符必须包含 _; 以执行函数体
    }

    // ---------- 状态 ----------
    // 这两个mapping就是“账本”。代币不存在于任何钱包里，只存在于这里。
    mapping(address => uint256) private _balances;
    mapping(address => mapping(address => uint256)) private _allowances;

    // ---------- 事件 ----------
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor() {
        owner = msg.sender;
    }

    // ---------- 只读查询 ----------
    function balanceOf(address account) public view returns (uint256) {
        return _balances[account];
    }

    function allowance(address _owner, address spender) public view returns (uint256) {
        return _allowances[_owner][spender];
    }

    // ---------- TODO 1: 转账 ----------
    // 要求：to不能是零地址；msg.sender 余额必须足够；
    // 扣msg.sender、加to；发出 Transfer事件；返回true。
    function transfer(address to, uint256 value) public returns (bool) {
        require(to != address(0), "HMKToken: transfer to the zero address");
        require(_balances[msg.sender] >= value, "HMKToken: transfer amount exceeds balance");
        
        _balances[msg.sender] -= value;
        _balances[to] += value;
        
        emit Transfer(msg.sender, to, value);
        return true;
    }

    // ---------- TODO 2: 授权 ----------
    // 要求：记录 msg.sender 允许 spender 花 value；发出Approval事件；返回true。
    function approve(address spender, uint256 value) public returns (bool) {
        require(spender != address(0), "HMKToken: approve to the zero address");
        
        _allowances[msg.sender][spender] = value;
        
        emit Approval(msg.sender, spender, value);
        return true;
    }

    // ---------- TODO 3: 代扣转账 ----------
    // 要求：from 的余额必须足够；msg.sender 在from 处的额度必须足够；
    // 额度减 value；扣from、加to；发出 Transfer事件；返回true。
    function transferFrom(address from, address to, uint256 value) public returns (bool) {
        require(to != address(0), "HMKToken: transfer to the zero address");
        require(_balances[from] >= value, "HMKToken: transfer amount exceeds balance");
        require(_allowances[from][msg.sender] >= value, "HMKToken: insufficient allowance");
        
        _allowances[from][msg.sender] -= value;
        _balances[from] -= value;
        _balances[to] += value;
        
        emit Transfer(from, to, value);
        return true;
    }

    // ---------- TODO 4: 增发(只有owner 能调) ----------
    // 要求：to不能是零地址；totalSupply 加 value； to 余额加 value；
    // 发出 Transfer事件，from填 address(0)。
    function mint(address to, uint256 value) public onlyOwner {
        require(to != address(0), "HMKToken: mint to the zero address");
        
        totalSupply += value;
        _balances[to] += value;
        
        emit Transfer(address(0), to, value);
    }

    // ---------- TODO 5: 销毁自己的代币 ----------
    // 要求：msg.sender 余额必须足够；余额减 value；totalSupply 减 value；
    // 发出 Transfer事件，to填 address(0)。
    function burn(uint256 value) public {
        require(_balances[msg.sender] >= value, "HMKToken: burn amount exceeds balance");
        
        _balances[msg.sender] -= value;
        totalSupply -= value;
        
        emit Transfer(msg.sender, address(0), value);
    }
}
