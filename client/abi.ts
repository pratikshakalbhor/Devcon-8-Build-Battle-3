import { parseAbi } from "viem"

/** ABI of `src/AnonBallot.sol` - only the functions/events the client actually uses. */
export const anonBallotAbi = parseAbi([
    "function castVote(uint256 ballotId, (uint256 merkleTreeDepth, uint256 merkleTreeRoot, uint256 nullifier, uint256 message, uint256 scope, uint256[8] points) proof)",
    "function getTally(uint256 ballotId) view returns (uint256[])",
    "function getBallot(uint256 ballotId) view returns (string question, uint8 optionCount, uint64 closesAt, uint256 groupId, uint256 scope, uint256[] tally)",
    "function ballotCount() view returns (uint256)",
    "function semaphore() view returns (address)",
    "event VoteCast(uint256 indexed ballotId, uint256 option, uint256 nullifier)",
    "event BallotCreated(uint256 indexed ballotId, uint256 indexed groupId, uint256 scope, string question, uint8 optionCount, uint64 closesAt)"
])

/**
 * ABI of the parts of `@semaphore-protocol/contracts` the client touches.
 * Group membership is administered here, never in AnonBallot.
 */
export const semaphoreAbi = parseAbi([
    "function addMembers(uint256 groupId, uint256[] identityCommitments)",
    "function getMerkleTreeRoot(uint256 groupId) view returns (uint256)",
    "function getMerkleTreeSize(uint256 groupId) view returns (uint256)",
    "event MemberAdded(uint256 indexed groupId, uint256 index, uint256 identityCommitment, uint256 merkleTreeRoot)",
    "event MembersAdded(uint256 indexed groupId, uint256 startIndex, uint256[] identityCommitments, uint256 merkleTreeRoot)"
])
