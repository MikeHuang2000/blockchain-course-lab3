import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { isAddress } from "ethers";

const deployEscrow: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const arbiter = process.env.ARBITER_ADDRESS ?? "";
  if (!arbiter) {
    throw new Error("Missing ARBITER_ADDRESS: export ARBITER_ADDRESS=0x... (组内仲裁人的地址)");
  }
  if (!isAddress(arbiter)) {
    throw new Error(`Invalid ARBITER_ADDRESS: ${arbiter} is not a valid address`);
  }

  const { deployer } = await hre.getNamedAccounts();
  await hre.deployments.deploy("Escrow", { from: deployer, args: [arbiter], log: true, autoMine: true });
};
export default deployEscrow;
deployEscrow.tags = ["EscrowHMK202430552423"];
