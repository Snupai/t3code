declare module "qrcode" {
  export interface QRCodeToStringOptions {
    readonly type?: "svg" | "utf8" | "terminal";
    readonly margin?: number;
    readonly width?: number;
    readonly errorCorrectionLevel?: "L" | "M" | "Q" | "H";
    readonly color?: {
      readonly dark?: string;
      readonly light?: string;
    };
  }

  const QRCode: {
    toString(value: string, options?: QRCodeToStringOptions): Promise<string>;
  };

  export default QRCode;
}
