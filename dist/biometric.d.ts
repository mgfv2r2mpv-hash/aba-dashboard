export type BiometryLabel = 'Face ID' | 'Touch ID' | 'biometric unlock';
export declare function isBiometricAvailable(): Promise<boolean>;
export declare function checkBiometryFull(): Promise<{
    available: boolean;
    label: BiometryLabel;
}>;
export declare function getBiometryLabel(): Promise<BiometryLabel>;
export declare function biometricAuthenticate(reason: string): Promise<boolean>;
//# sourceMappingURL=biometric.d.ts.map