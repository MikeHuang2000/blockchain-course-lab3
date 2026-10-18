import { Abi, BaseError as BaseViemError, ContractFunctionRevertedError, decodeErrorResult } from "viem";

const REVERT_DATA_REGEX = /^0x[0-9a-fA-F]+$/;

const findRevertData = (error: any): `0x${string}` | undefined => {
  const isRevertData = (value: any): value is `0x${string}` =>
    typeof value === "string" && REVERT_DATA_REGEX.test(value);

  const matched = typeof error?.walk === "function" ? error.walk((err: any) => isRevertData(err?.data)) : undefined;
  const data = matched?.data ?? error?.data;

  return isRevertData(data) ? data : undefined;
};

/**
 * Decodes the raw revert payload some RPCs return inside `error.data` instead of a readable message.
 * With an empty ABI viem still decodes the two built-in Solidity forms: `Error(string)` and `Panic(uint256)`.
 * Passing the ABIs of the deployed contracts additionally resolves custom errors.
 * @param e - error object
 * @param abi - optional ABI used to decode custom errors
 * @returns decoded reason, or undefined when there is nothing to decode
 */
export const decodeRevertReason = (error: any, abi: Abi = []): string | undefined => {
  const data = findRevertData(error);
  if (!data) return undefined;

  try {
    const { errorName, args } = decodeErrorResult({ abi, data });
    if (errorName === "Panic") {
      const code = (args as readonly bigint[])[0];
      return `Execution reverted with panic code 0x${code.toString(16)}`;
    }
    const reason = errorName === "Error" ? (args as readonly string[])[0] : undefined;
    const formatted = errorName === "Error" ? "" : `${errorName}(${(args ?? []).map(String).join(", ")})`;
    const detail = reason || formatted;
    return detail ? `Execution reverted with the following reason:\n${detail}` : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Parses an viem/wagmi error to get a displayable string
 * @param e - error object
 * @returns parsed error string
 */
export const getParsedError = (error: any): string => {
  const parsedError = error?.walk ? error.walk() : error;

  if (parsedError instanceof BaseViemError) {
    if (parsedError.details) {
      return parsedError.details;
    }

    if (parsedError.shortMessage) {
      if (
        parsedError instanceof ContractFunctionRevertedError &&
        parsedError.data &&
        parsedError.data.errorName !== "Error"
      ) {
        const customErrorArgs = parsedError.data.args?.toString() ?? "";
        return `${parsedError.shortMessage.replace(/reverted\.$/, "reverted with the following reason:")}\n${
          parsedError.data.errorName
        }(${customErrorArgs})`;
      }

      return parsedError.shortMessage;
    }

    return parsedError.message ?? parsedError.name ?? "An unknown error occurred";
  }

  // Some nodes (POTOS testnet) answer with { code, data, message: "" }: the reason only lives in `data`,
  // so an empty message must not be shown as-is.
  if (parsedError?.message) {
    return parsedError.message;
  }

  return decodeRevertReason(error) ?? "An unknown error occurred";
};
