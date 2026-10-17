import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const ARBITER = "<仲裁人地址>";

const deployEscrow: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  await hre.deployments.deploy("Escrow", { from: deployer, args: [ARBITER], log: true, autoMine: true });
};
export default deployEscrow;
deployEscrow.tags = ["EscrowHMK202430552423"];
