interface LockScreenProps {
    mode: 'create' | 'unlock';
    onCreate?: (pin: string) => Promise<void> | void;
    onVerify?: (pin: string) => Promise<boolean>;
    onBiometric?: () => Promise<boolean>;
    biometricAuto?: boolean;
    biometryLabel?: string;
}
export default function LockScreen({ mode, onCreate, onVerify, onBiometric, biometricAuto, biometryLabel }: LockScreenProps): any;
export {};
//# sourceMappingURL=LockScreen.d.ts.map