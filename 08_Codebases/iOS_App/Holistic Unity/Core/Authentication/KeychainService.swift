import Foundation
import Security

/// Securely stores and retrieves sensitive data from the iOS Keychain
final class KeychainService: Sendable {
    
    static let shared = KeychainService()
    
    private let serviceName = AppConstants.appBundleId
    
    private init() {}
    
    enum KeychainKey: String {
        case authToken
        case refreshToken
        case userId
        // Video session recovery (sensitive — stored in keychain, not UserDefaults)
        case activeSessionRoomName
        case activeSessionParticipantName
        case activeSessionBookingId
        case activeSessionStartTime
    }
    
    func save(_ data: Data, for key: KeychainKey) throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: serviceName,
            kSecAttrAccount as String: key.rawValue,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        ]
        
        // Delete existing item first
        SecItemDelete(query as CFDictionary)
        
        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw KeychainError.saveFailed(status)
        }
    }
    
    func save(_ string: String, for key: KeychainKey) throws {
        guard let data = string.data(using: .utf8) else {
            throw KeychainError.encodingFailed
        }
        try save(data, for: key)
    }
    
    func loadData(for key: KeychainKey) -> Data? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: serviceName,
            kSecAttrAccount as String: key.rawValue,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        
        guard status == errSecSuccess else { return nil }
        return result as? Data
    }
    
    func loadString(for key: KeychainKey) -> String? {
        guard let data = loadData(for: key) else { return nil }
        return String(data: data, encoding: .utf8)
    }
    
    func delete(key: KeychainKey) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: serviceName,
            kSecAttrAccount as String: key.rawValue
        ]
        SecItemDelete(query as CFDictionary)
    }
    
    func deleteAll() {
        for key in [KeychainKey.authToken, .refreshToken, .userId,
                    .activeSessionRoomName, .activeSessionParticipantName,
                    .activeSessionBookingId, .activeSessionStartTime] {
            delete(key: key)
        }
    }
    
    enum KeychainError: LocalizedError {
        case saveFailed(OSStatus)
        case encodingFailed
        
        var errorDescription: String? {
            switch self {
            case .saveFailed(let status): return "Keychain save failed with status: \(status)"
            case .encodingFailed: return "Failed to encode data for keychain"
            }
        }
    }
}
