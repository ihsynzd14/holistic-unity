import XCTest
@testable import Holistic_Unity

final class PurchaseOptionTests: XCTestCase {

    func test_singleEqualsSingle() {
        XCTAssertEqual(PurchaseOption.single, PurchaseOption.single)
    }

    func test_packEqualsPack() {
        XCTAssertEqual(PurchaseOption.pack, PurchaseOption.pack)
    }

    func test_useCreditEquals_sameCredit() {
        let credit = TestFactory.makeSessionCredit(id: "c1")
        XCTAssertEqual(PurchaseOption.useCredit(credit), PurchaseOption.useCredit(credit))
    }

    func test_useCreditNotEqual_differentCredit() {
        let a = TestFactory.makeSessionCredit(id: "c1")
        let b = TestFactory.makeSessionCredit(id: "c2")
        XCTAssertNotEqual(PurchaseOption.useCredit(a), PurchaseOption.useCredit(b))
    }

    func test_singleNotEqualPack() {
        XCTAssertNotEqual(PurchaseOption.single, PurchaseOption.pack)
    }

    func test_singleNotEqualUseCredit() {
        let credit = TestFactory.makeSessionCredit()
        XCTAssertNotEqual(PurchaseOption.single, PurchaseOption.useCredit(credit))
    }

    func test_packNotEqualUseCredit() {
        let credit = TestFactory.makeSessionCredit()
        XCTAssertNotEqual(PurchaseOption.pack, PurchaseOption.useCredit(credit))
    }
}
