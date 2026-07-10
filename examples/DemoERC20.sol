// SPDX-License-Identifier: MIT
pragma solidity ^0.7.0;

// Minimal ERC20 used by the QuantumSwap dApp test page (examples/dapp.html).
// Its creation bytecode is compiled with solc 0.7.6 (--optimize) and hardcoded
// into examples/dapp.js as ERC20_CREATION_BYTECODE. The constructor signature
// is constructor(string,string,uint256) so the page can ABI-encode
// (name, symbol, initialSupplyWei) and deploy via qc_sendTransaction.
contract DemoERC20 {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory name_, string memory symbol_, uint256 initialSupply_) {
        name = name_;
        symbol = symbol_;
        totalSupply = initialSupply_;
        balanceOf[msg.sender] = initialSupply_;
        emit Transfer(address(0), msg.sender, initialSupply_);
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= value, "ERC20: insufficient allowance");
        allowance[from][msg.sender] = allowed - value;
        _transfer(from, to, value);
        return true;
    }

    function _transfer(address from, address to, uint256 value) internal {
        require(to != address(0), "ERC20: transfer to zero address");
        uint256 bal = balanceOf[from];
        require(bal >= value, "ERC20: insufficient balance");
        balanceOf[from] = bal - value;
        balanceOf[to] = balanceOf[to] + value;
        emit Transfer(from, to, value);
    }
}
