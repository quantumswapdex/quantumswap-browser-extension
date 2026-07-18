// Ported from the FormatApi* ipcMain.handle handlers in the desktop src/index.js.
import { parseEther, formatEther, FixedNumber } from "quantumcoin";

export default {
  async FormatApiEtherToWei(data: any) {
    return parseEther(data);
  },

  async FormatApiWeiToEther(data: any) {
    return formatEther(data);
  },

  async FormatApiWeiToEtherCommified(data: any) {
    const etherAmount = formatEther(data);
    return etherAmount.toLocaleString();
  },

  async FormatApiIsValidEther(data: any) {
    try {
      if (data.startsWith("0")) {
        return false;
      }
      const number = FixedNumber.fromString(data);
      const isNegative = number.isNegative();
      return !isNegative;
    } catch {
      return false;
    }
  },

  async FormatApiCompareEther(data: any) {
    try {
      const number1 = FixedNumber.fromString(data.num1.replaceAll(",", ""));
      const number2 = FixedNumber.fromString(data.num2.replaceAll(",", ""));
      if (number1.isNegative() || number2.isNegative()) {
        throw new Error("error parsing numbers. negative values.");
      }

      if (number1.eq(number2)) {
        return 0;
      } else if (number1.gt(number2)) {
        return 1;
      } else {
        return -1;
      }
    } catch {
      throw new Error("error parsing numbers");
    }
  },
};
